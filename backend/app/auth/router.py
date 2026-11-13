import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.auth import service
from app.auth.models import User
from app.core.config import get_settings
from app.core.db import TransactionalRoute
from app.core.deps import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, AccountUser, SessionDep
from app.core.errors import DomainError, Unauthorized
from app.core.ratelimit import limiter

router = APIRouter(route_class=TransactionalRoute, prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)
    totp_code: str | None = Field(None, max_length=10)


class MeOut(BaseModel):
    id: str
    username: str
    full_name: str
    roles: list[str]
    permissions: list[str]
    totp_enabled: bool
    # Forced steps: nothing else in the app is reachable until they are done (403 from every other route).
    must_change_password: bool
    must_enroll_totp: bool
    password_is_temporary: bool
    temp_password_expires_at: datetime | None
    password_changed_at: datetime | None


def _me(u: User) -> MeOut:
    return MeOut(
        id=str(u.id),
        username=u.username,
        full_name=u.full_name,
        roles=sorted(r.code for r in u.roles),
        # no permissions until the forced steps are done, so the UI shows nothing it couldn't use
        permissions=[] if u.must_change_password or u.must_enroll_totp else sorted(u.permission_codes()),
        totp_enabled=u.totp_enabled,
        must_change_password=u.must_change_password,
        must_enroll_totp=u.must_enroll_totp,
        password_is_temporary=u.temp_password_expires_at is not None,
        temp_password_expires_at=u.temp_password_expires_at,
        password_changed_at=u.password_changed_at,
    )


def _set_cookies(response: Response, tokens: service.Tokens) -> None:
    s = get_settings()
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access,
        max_age=s.access_token_minutes * 60,
        path="/",
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh,
        max_age=s.refresh_token_days * 86400,
        path="/api/v1/auth",
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
    )
    response.set_cookie(
        CSRF_COOKIE, secrets.token_urlsafe(32), httponly=False, secure=s.cookie_secure, samesite="strict", path="/"
    )


@router.post("/login", response_model=MeOut)
@limiter.limit(lambda: get_settings().rate_limit_login)
async def login(request: Request, body: LoginIn, response: Response, session: SessionDep) -> MeOut:
    try:
        tokens = await service.login(session, body.username, body.password, body.totp_code)
    except DomainError:
        await session.commit()  # persist failed-login counter, lockout and audit entry
        raise
    _set_cookies(response, tokens)
    return _me(tokens.user)


@router.post("/refresh", response_model=MeOut)
async def refresh(request: Request, response: Response, session: SessionDep) -> MeOut:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise Unauthorized("No refresh token", code="RefreshMissing")
    try:
        tokens = await service.refresh(session, token)
    except Unauthorized:
        await session.commit()
        raise
    _set_cookies(response, tokens)
    return _me(tokens.user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, user: AccountUser, session: SessionDep) -> None:
    await service.logout(session, user, request.cookies.get(REFRESH_COOKIE))
    _clear_cookies(response)


def _clear_cookies(response: Response) -> None:
    for c in (ACCESS_COOKIE, CSRF_COOKIE):
        response.delete_cookie(c, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=MeOut)
async def me(user: AccountUser) -> MeOut:
    return _me(user)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)  # policy (length etc.) is enforced by the service
    sign_out_other_devices: bool = True


@router.post("/change-password", response_model=MeOut)
@limiter.limit(lambda: get_settings().rate_limit_change_password_ip)
async def change_password(
    request: Request, body: ChangePasswordIn, response: Response, user: AccountUser, session: SessionDep
) -> MeOut:
    """Also the forced landing step after a temporary password (must_change_password)."""
    try:
        tokens = await service.change_password(
            session,
            user,
            body.current_password,
            body.new_password,
            body.sign_out_other_devices,
            mfa=bool(getattr(request.state, "mfa", False)),
        )
    except DomainError:
        await session.commit()  # persist the failed-attempt counter, lockout and audit entry
        raise
    if tokens is not None:  # other devices were signed out: this one continues with the new token version
        _set_cookies(response, tokens)
    return _me(user)


class PasswordPolicyOut(BaseModel):
    min_length: int
    max_length: int
    history_count: int
    forbidden_words: list[str]
    breach_check: bool


@router.get("/password-policy", response_model=PasswordPolicyOut)
async def password_policy(_: AccountUser, session: SessionDep) -> PasswordPolicyOut:
    """The configured policy (master data), shown up front on the change-password screen."""
    return await _policy(session)


class TotpConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=8)


@router.post("/totp/setup")
async def totp_setup(user: AccountUser, session: SessionDep) -> dict[str, str]:
    """Starts enrolment (also the forced step after an admin "Reset 2FA"). Refused while 2FA is on."""
    return await service.begin_totp(session, user)


@router.post("/totp/confirm", response_model=MeOut)
async def totp_confirm(body: TotpConfirm, response: Response, user: AccountUser, session: SessionDep) -> MeOut:
    _set_cookies(response, await service.confirm_totp(session, user, body.code))  # now a 2FA-verified session
    return _me(user)


__all__ = ["Depends", "router"]


# ---------------------------------------------------------------- reset by email (Phase 2)
class ForgotIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)  # username or registered email
    captcha_token: str | None = Field(None, max_length=4096)


class MessageOut(BaseModel):
    message: str


class ForgotConfigOut(BaseModel):
    captcha_provider: str
    captcha_site_key: str | None


@router.get("/forgot-password/config", response_model=ForgotConfigOut)
async def forgot_config() -> ForgotConfigOut:
    s = get_settings()
    return ForgotConfigOut(captcha_provider=s.captcha_provider, captcha_site_key=s.captcha_site_key)


@router.post("/forgot-password", response_model=MessageOut, status_code=202)
@limiter.limit(lambda: get_settings().rate_limit_forgot_ip)
async def forgot_password(request: Request, response: Response, body: ForgotIn, session: SessionDep) -> MessageOut:
    """Same answer, about the same time, for any input (no account enumeration). Only CaptchaRequired (428) differs,
    and that depends on the caller's IP, not on the account."""
    from app.auth import reset

    try:
        await reset.request_reset(session, body.identifier, body.captcha_token)
    except DomainError:
        await session.commit()
        raise
    return MessageOut(message=reset.GENERIC)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class TokenCheckOut(BaseModel):
    valid: bool
    requires_totp: bool = False
    username: str | None = None
    full_name: str | None = None
    policy: PasswordPolicyOut | None = None


async def _policy(session: SessionDep) -> PasswordPolicyOut:
    from app.auth.policy import KEYS
    from app.core.settings_store import get_settings_map

    c = await get_settings_map(session, KEYS)
    return PasswordPolicyOut(
        min_length=int(c["password.min_length"]),
        max_length=int(c["password.max_length"]),
        history_count=int(c["password.history_count"]),
        forbidden_words=[str(w) for w in c["password.forbidden_words"]],
        breach_check=bool(c["password.breach_check"]),
    )


@router.post("/reset-password/check", response_model=TokenCheckOut)
@limiter.limit(lambda: get_settings().rate_limit_reset_ip)
async def reset_password_check(
    request: Request, response: Response, body: TokenIn, session: SessionDep
) -> TokenCheckOut:
    """Validates a reset link before the form is shown. Invalid, used and expired links get the same answer."""
    from app.auth import reset

    user = await reset.check_token(session, body.token)
    if user is None:
        return TokenCheckOut(valid=False)
    return TokenCheckOut(
        valid=True,
        requires_totp=user.totp_enabled,
        username=user.username,
        full_name=user.full_name,
        policy=await _policy(session),
    )


class ResetIn(TokenIn):
    new_password: str = Field(min_length=1, max_length=200)
    totp_code: str | None = Field(None, max_length=10)


@router.post("/reset-password", status_code=204)
@limiter.limit(lambda: get_settings().rate_limit_reset_ip)
async def reset_password(request: Request, response: Response, body: ResetIn, session: SessionDep) -> None:
    """Sets the new password; every session ends. The user then signs in (never signed in automatically)."""
    from app.auth import reset

    try:
        await reset.complete_reset(session, body.token, body.new_password, body.totp_code)
    except DomainError:
        await session.commit()  # keep the "invalid link" / failed-2FA entries in the activity log
        raise
