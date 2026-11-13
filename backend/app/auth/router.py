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
            session, user, body.current_password, body.new_password, body.sign_out_other_devices
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


class TotpConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=8)


@router.post("/totp/setup")
async def totp_setup(user: AccountUser, session: SessionDep) -> dict[str, str]:
    """Starts enrolment (also the forced step after an admin "Reset 2FA"). Refused while 2FA is on."""
    return await service.begin_totp(session, user)


@router.post("/totp/confirm", response_model=MeOut)
async def totp_confirm(body: TotpConfirm, user: AccountUser, session: SessionDep) -> MeOut:
    await service.confirm_totp(session, user, body.code)
    return _me(user)


__all__ = ["Depends", "router"]
