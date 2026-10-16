"""Authentication service: login with lockout, optional TOTP, refresh rotation, logout."""

from dataclasses import dataclass
from datetime import timedelta

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import RefreshToken, User
from app.core.config import get_settings
from app.core.context import with_user
from app.core.errors import Unauthorized
from app.core.security import (
    burn_password_check,
    create_token,
    decode_token,
    new_totp_secret,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.core.timeutil import now_utc

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


async def _issue(session: AsyncSession, user: User) -> Tokens:
    s = get_settings()
    access, _ = create_token(user.id, "access", timedelta(minutes=s.access_token_minutes))
    refresh, jti = create_token(user.id, "refresh", timedelta(days=s.refresh_token_days))
    session.add(RefreshToken(user_id=user.id, jti=jti, expires_at=now_utc() + timedelta(days=s.refresh_token_days)))
    return Tokens(access, refresh, user)


async def login(session: AsyncSession, username: str, password: str, totp_code: str | None) -> Tokens:
    """Failures are committed by the caller even though an error is raised (see router)."""
    s = get_settings()
    user = (
        await session.execute(select(User).where(User.username == username.strip().lower()).with_for_update())
    ).scalar_one_or_none()
    if user is None:
        burn_password_check(password)
        audit.record(session, "LOGIN_FAILED", f"Failed login for unknown user '{username[:80]}'")
        raise Unauthorized("Invalid username or password", code="InvalidCredentials")
    now = now_utc()
    if user.locked_until and user.locked_until > now:
        audit.record(
            session,
            "LOGIN_FAILED",
            f"Login attempt on locked account {user.username}",
            entity_type="users",
            entity_id=user.id,
            entity_ref=user.username,
        )
        raise Unauthorized("Account locked. Try again later or contact an administrator.", code="AccountLocked")
    if not user.is_active or not verify_password(password, user.password_hash):
        user.failed_logins += 1
        msg = f"Failed login for {user.username} ({user.failed_logins} consecutive)"
        if user.failed_logins >= s.max_failed_logins:
            user.locked_until = now + timedelta(minutes=s.lockout_minutes)
            msg += "; account locked"
        audit.record(session, "LOGIN_FAILED", msg, entity_type="users", entity_id=user.id, entity_ref=user.username)
        raise Unauthorized("Invalid username or password", code="InvalidCredentials")
    if user.totp_enabled:
        secret = _fernet().decrypt((user.totp_secret_enc or "").encode()).decode()
        if not totp_code:
            raise Unauthorized("Two-factor code required", code="TotpRequired")
        if not verify_totp(secret, totp_code):
            user.failed_logins += 1
            audit.record(
                session,
                "LOGIN_FAILED",
                f"Invalid 2FA code for {user.username}",
                entity_type="users",
                entity_id=user.id,
                entity_ref=user.username,
            )
            raise Unauthorized("Invalid two-factor code", code="TotpInvalid")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    with_user(user.id, user.username)
    audit.record(
        session, "LOGIN", f"{user.username} signed in", entity_type="users", entity_id=user.id, entity_ref=user.username
    )
    return await _issue(session, user)


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
    return await _issue(session, user)


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
    audit.record(
        session,
        "LOGOUT",
        f"{user.username} signed out",
        entity_type="users",
        entity_id=user.id,
        entity_ref=user.username,
    )


async def begin_totp(user: User) -> dict[str, str]:
    secret = new_totp_secret()
    user.totp_secret_enc = _fernet().encrypt(secret.encode()).decode()
    user.totp_enabled = False
    return {"otpauth_uri": totp_uri(secret, user.username)}


async def confirm_totp(session: AsyncSession, user: User, code: str) -> None:
    secret = _fernet().decrypt((user.totp_secret_enc or "").encode()).decode()
    if not verify_totp(secret, code):
        raise Unauthorized("Invalid two-factor code", code="TotpInvalid")
    user.totp_enabled = True
    audit.record(
        session,
        "TOTP_ENABLED",
        f"2FA enabled for {user.username}",
        entity_type="users",
        entity_id=user.id,
        entity_ref=user.username,
    )
