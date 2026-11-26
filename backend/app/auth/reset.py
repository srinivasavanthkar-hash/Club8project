"""Password reset by email (docs/PASSWORD_PROMPT.md Sections 2 and 3A).

* "Forgot password" always answers the same and takes about the same time, whether or not the account exists,
  is inactive or has no email (no account enumeration). Limits: per account and per IP per hour (system_settings);
  requests over a limit get the same answer and send nothing. CAPTCHA after N requests per IP per hour.
* Tokens: 32 random bytes; only the SHA-256 is stored; valid `password.reset_token_minutes`; single use; a newer
  request invalidates older unused tokens. The email goes to the REGISTERED address only. Links are built from
  CRM_APP_BASE_URL, never from the request.
* Completing a reset needs the current TOTP code when 2FA is on (a reset never bypasses or removes 2FA), applies the
  password policy, revokes every session, clears any lockout and sends a "password changed" notice. The user is not
  signed in automatically.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import random
import secrets
import time
import uuid
from datetime import timedelta

import httpx
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import PasswordResetToken, User
from app.auth.notify import security_notice
from app.auth.policy import policy_problems, remember
from app.core.config import get_settings
from app.core.context import get_context
from app.core.errors import DomainError, RuleViolation, Unauthorized
from app.core.ratelimit import hit_account
from app.core.security import hash_password, verify_totp
from app.core.settings_store import get_setting, get_settings_map
from app.core.timeutil import real_now_utc
from app.email import dispatch

GENERIC = "If an account matches, we've sent password reset instructions to its registered email."
INVALID = "This reset link is invalid or has expired."
MIN_SECONDS = 0.6  # every "forgot password" answer takes at least this long (plus jitter)


class CaptchaRequired(DomainError):
    status = 428
    title = "Verification required"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _audit(session: AsyncSession, action: str, summary: str, user: User | None = None) -> None:
    audit.record(
        session,
        action,
        summary,
        entity_type="users" if user else None,
        entity_id=user.id if user else None,
        entity_ref=user.username if user else None,
    )


async def verify_captcha(token: str | None) -> bool:
    s = get_settings()
    if s.captcha_provider == "none":
        return True
    if not token or not s.captcha_secret_key:
        return False
    url = {
        "turnstile": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        "hcaptcha": "https://api.hcaptcha.com/siteverify",
    }[s.captcha_provider]
    data = {"secret": s.captcha_secret_key.get_secret_value(), "response": token}
    if get_context().ip:
        data["remoteip"] = get_context().ip or ""
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.post(url, data=data)
        return bool(r.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False


async def issue_reset_link(
    session: AsyncSession, user: User, *, purpose: str = "SELF", created_by: uuid.UUID | None = None
) -> None:
    """Invalidate older unused links, store the new token's hash and email the link to the registered address."""
    assert user.email, "callers check for a registered email"
    now = real_now_utc()
    await session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.invalidated_at.is_(None),
        )
        .values(invalidated_at=now)
    )
    minutes = int(await get_setting(session, "password.reset_token_minutes"))
    raw = secrets.token_urlsafe(32)
    ctx = get_context()
    session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash(raw),
            purpose=purpose,
            created_by=created_by,
            expires_at=now + timedelta(minutes=minutes),
            request_ip=ctx.ip,
            user_agent=(ctx.user_agent or "")[:400] or None,
        )
    )
    link = f"{get_settings().app_base_url.rstrip('/')}/reset-password?token={raw}"
    dispatch.queue(
        session,
        to=user.email,
        template="reset_link",
        subject="Reset your Club8 CRM password",
        context={
            "name": user.full_name,
            "username": user.username,
            "link": link,
            "minutes": minutes,
            "totp": user.totp_enabled,
            "by_admin": purpose == "ADMIN_LINK",
        },
        user_id=str(user.id),
        username=user.username,
        kind="RESET_LINK",
    )


async def request_reset(session: AsyncSession, identifier: str, captcha_token: str | None) -> None:
    """Always returns normally (the caller answers GENERIC) except CaptchaRequired, which depends only on the IP."""
    start = time.monotonic()
    try:
        await _request_reset(session, identifier, captcha_token)
    finally:
        pad = MIN_SECONDS - (time.monotonic() - start)
        await asyncio.sleep(max(pad, 0) + random.uniform(0, 0.1))  # noqa: S311 - timing jitter, not security


async def _request_reset(session: AsyncSession, identifier: str, captcha_token: str | None) -> None:
    cfg = await get_settings_map(
        session,
        [
            "password.forgot_per_ip_per_hour",
            "password.forgot_per_account_per_hour",
            "password.captcha_after_per_ip_per_hour",
        ],
    )
    ip = get_context().ip or "anon"
    if not await hit_account("forgot-ip", ip, f"{cfg['password.forgot_per_ip_per_hour']}/hour"):
        _audit(session, "RATE_LIMITED", "Forgot-password limit per IP reached: nothing sent")
        return
    if get_settings().captcha_provider != "none" and not await hit_account(
        "forgot-captcha", ip, f"{cfg['password.captcha_after_per_ip_per_hour']}/hour"
    ):
        if not await verify_captcha(captcha_token):
            raise CaptchaRequired(
                "Please complete the check to continue.",
                code="CaptchaRequired",
                extra={
                    "captcha_provider": get_settings().captcha_provider,
                    "site_key": get_settings().captcha_site_key,
                },
            )
    ident = identifier.strip().lower()
    user = (
        (
            await session.execute(
                select(User)
                .where(or_(func.lower(User.username) == ident, func.lower(User.email) == ident))
                .order_by(User.is_active.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if user is None:
        # never store the typed value in full
        _audit(
            session,
            "FORGOT_PASSWORD_REQUESTED",
            f"Forgot password for an unknown account ('{ident[:2]}…'): nothing sent",
        )
        return
    if not user.is_active or not user.email:
        why = "inactive account" if not user.is_active else "no registered email"
        _audit(session, "FORGOT_PASSWORD_REQUESTED", f"Forgot password for {user.username} ({why}): nothing sent", user)
        return
    if not await hit_account("forgot-account", str(user.id), f"{cfg['password.forgot_per_account_per_hour']}/hour"):
        _audit(session, "RATE_LIMITED", f"Forgot-password limit for {user.username} reached: nothing sent", user)
        return
    await issue_reset_link(session, user)
    _audit(session, "FORGOT_PASSWORD_REQUESTED", f"Reset link requested for {user.username}", user)


async def _valid_token(session: AsyncSession, raw: str) -> tuple[PasswordResetToken, User] | None:
    h = _hash(raw)
    row = (
        await session.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == h).with_for_update())
    ).scalar_one_or_none()
    if row is None or not hmac.compare_digest(row.token_hash, h):
        _audit(session, "RESET_LINK_INVALID", "Unknown reset link used")
        return None
    user = await session.get(User, row.user_id)
    problem = (
        "already used"
        if row.used_at
        else "replaced by a newer link"
        if row.invalidated_at
        else "expired"
        if row.expires_at <= real_now_utc()
        else "inactive account"
        if user is None or not user.is_active
        else None
    )
    if problem or user is None:
        _audit(session, "RESET_LINK_INVALID", f"Reset link {problem} for {user.username if user else 'unknown'}", user)
        return None
    return row, user


async def check_token(session: AsyncSession, raw: str) -> User | None:
    found = await _valid_token(session, raw)
    return found[1] if found else None


async def complete_reset(session: AsyncSession, raw: str, new_password: str, totp_code: str | None) -> None:
    found = await _valid_token(session, raw)
    if found is None:
        raise RuleViolation(INVALID, code="ResetLinkInvalid")
    row, user = found
    if user.totp_enabled:  # a reset never bypasses 2FA
        from app.auth.service import _fernet

        if not totp_code:
            raise Unauthorized("Enter the code from your authenticator app.", code="TotpRequired")
        secret = _fernet().decrypt((user.totp_secret_enc or "").encode()).decode()
        if not verify_totp(secret, totp_code):
            _audit(session, "PASSWORD_RESET_FAILED", f"Invalid 2FA code on the reset form for {user.username}", user)
            raise Unauthorized("Invalid two-factor code", code="TotpInvalid")
    problems = await policy_problems(session, new_password, username=user.username, full_name=user.full_name, user=user)
    if problems:
        raise RuleViolation(
            " ".join(p.message for p in problems),
            code="PasswordPolicy",
            extra={"problems": [{"code": p.code, "message": p.message} for p in problems]},
        )
    now = real_now_utc()
    user.password_hash = hash_password(new_password)
    user.password_changed_at = now
    await remember(session, user.id, user.password_hash, int(await get_setting(session, "password.history_count")))
    user.must_change_password = False
    user.temp_password_expires_at = None
    user.temp_password_expired_at = None
    if user.locked_until or user.failed_logins:
        if user.locked_until:
            _audit(session, "LOCKOUT_CLEARED", f"Lockout of {user.username} cleared by a password reset", user)
        user.failed_logins = 0
        user.locked_until = None
    row.used_at = now
    await session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id, PasswordResetToken.id != row.id, PasswordResetToken.used_at.is_(None)
        )
        .values(invalidated_at=now)
    )
    from app.auth.service import revoke_all_sessions

    await revoke_all_sessions(session, user, "password reset by email link")
    _audit(session, "PASSWORD_RESET_COMPLETED", f"{user.username} set a new password with a reset link", user)
    security_notice(session, user, "Your password was changed", "It was changed with a password reset link.")
