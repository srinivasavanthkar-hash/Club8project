"""Authentication service: login with lockout, optional TOTP, refresh rotation, logout, change password, session
revocation. Admin-initiated recovery (temporary passwords, 2FA reset, ADMIN approvals) lives in auth/recovery.py.

Never log, audit or return a password, a temporary password, a hash or a token (docs/PASSWORD_PROMPT.md Section 6).
"""

from dataclasses import dataclass
from datetime import timedelta

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import RefreshToken, User
from app.auth.policy import policy_problems, remember
from app.core.config import get_settings
from app.core.context import with_user
from app.core.errors import Conflict, Forbidden, RuleViolation, TooManyRequests, Unauthorized
from app.core.ratelimit import hit_account
from app.core.security import (
    burn_password_check,
    create_token,
    decode_token,
    hash_password,
    new_totp_secret,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.core.settings_store import get_setting
from app.core.timeutil import fmt_dt_ist, now_utc

ADMIN_ROLES_REQUIRING_2FA_OPTION = {"ADMIN", "MANAGEMENT"}


def _fernet() -> Fernet:
    import base64
    import hashlib

    key = hashlib.sha256(b"totp|" + get_settings().jwt_signing_key.get_secret_value().encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


@dataclass
class Tokens:
    access: str
    refresh: str
    user: User


def _audit_user(session: AsyncSession, action: str, summary: str, user: User) -> None:
    audit.record(session, action, summary, entity_type="users", entity_id=user.id, entity_ref=user.username)


async def _issue(session: AsyncSession, user: User, *, mfa: bool) -> Tokens:
    """`mfa` records whether this session passed two-step verification (the TOTP code at sign-in, or enrolling
    2FA in this session). Password changes require it for users who have 2FA on."""
    s = get_settings()
    claims = {"tv": user.token_version, "mfa": mfa}
    access, _ = create_token(user.id, "access", timedelta(minutes=s.access_token_minutes), claims)
    refresh, jti = create_token(user.id, "refresh", timedelta(days=s.refresh_token_days), claims)
    session.add(RefreshToken(user_id=user.id, jti=jti, expires_at=now_utc() + timedelta(days=s.refresh_token_days)))
    return Tokens(access, refresh, user)


def temp_password_expired(user: User) -> bool:
    return user.temp_password_expires_at is not None and user.temp_password_expires_at <= now_utc()


async def login(session: AsyncSession, username: str, password: str, totp_code: str | None) -> Tokens:
    """Failures are committed by the caller even though an error is raised (see router)."""
    s = get_settings()
    if not await hit_account("login", username, s.rate_limit_login_account):
        burn_password_check(password)  # same timing as any other refusal
        audit.record(session, "RATE_LIMITED", f"Sign-in rate limit reached for '{username.strip().lower()[:80]}'")
        raise TooManyRequests("Too many sign-in attempts. Wait a minute and try again.", code="RateLimited")
    user = (
        await session.execute(select(User).where(User.username == username.strip().lower()).with_for_update())
    ).scalar_one_or_none()
    if user is None:
        burn_password_check(password)
        audit.record(session, "LOGIN_FAILED", f"Failed login for unknown user '{username[:80]}'")
        raise Unauthorized("Incorrect username or password", code="InvalidCredentials")
    now = now_utc()
    if user.locked_until and user.locked_until > now:
        _audit_user(session, "LOGIN_FAILED", f"Login attempt on locked account {user.username}", user)
        raise Unauthorized(
            f"Account locked until {fmt_dt_ist(user.locked_until)} (India time). "
            "Try again then, or ask an administrator to reset your password.",
            code="AccountLocked",
        )
    if not user.is_active or not verify_password(password, user.password_hash):
        user.failed_logins += 1
        msg = f"Failed login for {user.username} ({user.failed_logins} consecutive)"
        if user.failed_logins >= s.max_failed_logins:
            user.locked_until = now + timedelta(minutes=s.lockout_minutes)
            msg += "; account locked"
        _audit_user(session, "LOGIN_FAILED", msg, user)
        raise Unauthorized("Incorrect username or password", code="InvalidCredentials")
    # 2FA is checked before anything else about the account is revealed, including a temporary password's state:
    # sign in -> 2FA code (if enabled) -> forced change-password screen.
    if user.totp_enabled:
        secret = _fernet().decrypt((user.totp_secret_enc or "").encode()).decode()
        if not totp_code:
            raise Unauthorized("Two-factor code required", code="TotpRequired")
        if not verify_totp(secret, totp_code):
            user.failed_logins += 1
            _audit_user(session, "LOGIN_FAILED", f"Invalid 2FA code for {user.username}", user)
            raise Unauthorized("Invalid two-factor code", code="TotpInvalid")
    if temp_password_expired(user):
        _audit_user(session, "TEMP_PASSWORD_EXPIRED", f"Expired temporary password used by {user.username}", user)
        raise Unauthorized(
            "Your temporary password has expired. Ask an administrator for a new one.",
            code="TemporaryPasswordExpired",
        )
    if user.locked_until:
        _audit_user(session, "LOCKOUT_CLEARED", f"Lockout of {user.username} cleared by a successful sign-in", user)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    with_user(user.id, user.username)
    _audit_user(session, "LOGIN", f"{user.username} signed in", user)
    if user.temp_password_expires_at is not None:
        _audit_user(session, "TEMP_PASSWORD_USED", f"{user.username} signed in with a temporary password", user)
    await _apply_mandatory_2fa(session, user)
    # mfa: this session passed the TOTP step (only users with 2FA on can have done so)
    return await _issue(session, user, mfa=user.totp_enabled)


async def _apply_mandatory_2fa(session: AsyncSession, user: User) -> None:
    """Roles listed in `security.require_2fa_roles` must use 2FA: a user in such a role without 2FA must enrol at
    this sign-in, before anything else (same forced step as after an admin "Reset 2FA")."""
    if user.totp_enabled or user.must_enroll_totp:
        return
    required = {str(r) for r in await get_setting(session, "security.require_2fa_roles")}
    hits = sorted(required & {r.code for r in user.roles})
    if hits:
        user.must_enroll_totp = True
        _audit_user(
            session,
            "TOTP_ENROLMENT_REQUIRED",
            f"{user.username} must set up 2FA: required for role {', '.join(hits)}",
            user,
        )


async def refresh(session: AsyncSession, token: str) -> Tokens:
    import jwt

    try:
        data = decode_token(token, "refresh")
    except jwt.PyJWTError as e:
        raise Unauthorized("Refresh token invalid", code="RefreshInvalid") from e
    row = (
        await session.execute(select(RefreshToken).where(RefreshToken.jti == data["jti"]).with_for_update())
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        # Reuse of a rotated token: revoke every session of that user.
        if row is not None:
            for t in (
                await session.execute(
                    select(RefreshToken).where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
                )
            ).scalars():
                t.revoked_at = now_utc()
        raise Unauthorized("Refresh token revoked", code="RefreshRevoked")
    row.revoked_at = now_utc()
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("User inactive", code="UserInactive")
    if data.get("tv", 0) != user.token_version:
        raise Unauthorized("Your session has ended. Sign in again.", code="SessionRevoked")
    return await _issue(session, user, mfa=bool(data.get("mfa")))


async def logout(session: AsyncSession, user: User, refresh_token: str | None) -> None:
    if refresh_token:
        try:
            data = decode_token(refresh_token, "refresh")
            row = (
                await session.execute(select(RefreshToken).where(RefreshToken.jti == data["jti"]))
            ).scalar_one_or_none()
            if row:
                row.revoked_at = now_utc()
        except Exception:  # noqa: S110 - logout must always succeed
            pass
    _audit_user(session, "LOGOUT", f"{user.username} signed out", user)


async def revoke_all_sessions(session: AsyncSession, user: User, why: str) -> int:
    """End every session of `user` on every device: bump the token version (access tokens stop working on their
    next request) and revoke all refresh tokens. Returns the number of refresh tokens revoked."""
    user.token_version += 1
    now = now_utc()
    rows = list(
        (
            await session.execute(
                select(RefreshToken).where(
                    RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > now
                )
            )
        ).scalars()
    )
    for t in rows:
        t.revoked_at = now
    _audit_user(session, "SESSIONS_REVOKED", f"All sessions of {user.username} ended ({len(rows)}): {why}", user)
    return len(rows)


async def change_password(
    session: AsyncSession, user: User, current: str, new: str, sign_out_other_devices: bool, *, mfa: bool
) -> Tokens | None:
    """Returns fresh tokens for this device when the other sessions were ended, else None (cookies unchanged).
    Failures are committed by the caller (failed-attempt counter, lockout and audit entry).

    `mfa`: whether this session passed 2FA. A user with 2FA on can only change the password from such a session
    (sign in -> 2FA code -> change password), e.g. never from a session that predates turning 2FA on."""
    s = get_settings()
    if user.totp_enabled and not mfa:
        _audit_user(session, "PASSWORD_CHANGE_FAILED", f"Password change without 2FA refused for {user.username}", user)
        raise Forbidden(
            "Sign in again with your two-step verification code to change your password.", code="MfaRequired"
        )
    if not await hit_account("change-password", str(user.id), s.rate_limit_change_password):
        _audit_user(session, "RATE_LIMITED", f"Change-password rate limit reached for {user.username}", user)
        raise TooManyRequests("Too many attempts. Wait a minute and try again.", code="RateLimited")
    now = now_utc()
    if user.locked_until and user.locked_until > now:
        raise Forbidden(
            f"Too many incorrect attempts. Try again after {fmt_dt_ist(user.locked_until)} (India time).",
            code="AccountLocked",
        )
    forced = user.must_change_password
    if not verify_password(current, user.password_hash):
        user.failed_logins += 1  # repeated wrong current passwords count toward lockout
        msg = f"Incorrect current password for {user.username} ({user.failed_logins} consecutive)"
        if user.failed_logins >= s.max_failed_logins:
            user.locked_until = now + timedelta(minutes=s.lockout_minutes)
            msg += "; account locked"
        _audit_user(session, "PASSWORD_CHANGE_FAILED", msg, user)
        what = "temporary password" if forced else "current password"
        raise Unauthorized(f"Your {what} is incorrect.", code="CurrentPasswordIncorrect")
    if temp_password_expired(user):
        raise Unauthorized(
            "Your temporary password has expired. Ask an administrator for a new one.",
            code="TemporaryPasswordExpired",
        )
    problems = await policy_problems(session, new, username=user.username, full_name=user.full_name, user=user)
    if problems:
        raise RuleViolation(
            " ".join(p.message for p in problems),
            code="PasswordPolicy",
            extra={"problems": [{"code": p.code, "message": p.message} for p in problems]},
        )
    user.password_hash = hash_password(new)
    user.password_changed_at = now
    user.failed_logins = 0
    user.locked_until = None
    await remember(session, user.id, user.password_hash, int(await get_setting(session, "password.history_count")))
    user.must_change_password = False
    user.temp_password_expires_at = None
    user.temp_password_expired_at = None
    # After a temporary password the other sessions always end: someone else knew that password.
    end_others = sign_out_other_devices or forced
    _audit_user(
        session,
        "PASSWORD_CHANGED",
        f"{user.username} changed their password"
        f"{' (replacing a temporary password)' if forced else ''}; "
        f"other devices {'signed out' if end_others else 'left signed in'}",
        user,
    )
    from app.auth.notify import security_notice

    security_notice(
        session,
        user,
        "Your password was changed",
        "Other devices were signed out." if end_others else "Other devices stayed signed in.",
    )
    if not end_others:
        return None
    await revoke_all_sessions(session, user, "password changed")
    return await _issue(session, user, mfa=mfa)  # this device stays signed in with the new token version


async def begin_totp(session: AsyncSession, user: User) -> dict[str, str]:
    # Switching 2FA off or replacing the authenticator is only possible through an admin "Reset 2FA" (with reason
    # and permission). Otherwise anyone holding a signed-in session could silently remove 2FA.
    if user.totp_enabled:
        raise Conflict(
            "Two-step verification is already on. Ask an administrator to reset it to use a new device.",
            code="TotpAlreadyEnabled",
        )
    secret = new_totp_secret()
    user.totp_secret_enc = _fernet().encrypt(secret.encode()).decode()
    return {"otpauth_uri": totp_uri(secret, user.username), "secret": secret}


async def confirm_totp(session: AsyncSession, user: User, code: str) -> Tokens:
    """Enrolment proves possession of the authenticator, so this device continues as a 2FA-verified session."""
    if user.totp_enabled:
        raise Conflict("Two-step verification is already on.", code="TotpAlreadyEnabled")
    if not user.totp_secret_enc:
        raise Conflict("Start the set-up first.", code="TotpNotStarted")
    secret = _fernet().decrypt(user.totp_secret_enc.encode()).decode()
    if not verify_totp(secret, code):
        raise Unauthorized("Invalid two-factor code", code="TotpInvalid")
    user.totp_enabled = True
    user.must_enroll_totp = False
    _audit_user(session, "TOTP_ENABLED", f"2FA enabled for {user.username}", user)
    return await _issue(session, user, mfa=True)
