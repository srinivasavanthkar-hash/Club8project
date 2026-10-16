import secrets

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.auth import service
from app.auth.models import User
from app.core.config import get_settings
from app.core.db import TransactionalRoute
from app.core.deps import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, CurrentUser, SessionDep
from app.core.errors import Unauthorized
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


def _me(u: User) -> MeOut:
    return MeOut(
        id=str(u.id),
        username=u.username,
        full_name=u.full_name,
        roles=sorted(r.code for r in u.roles),
        permissions=sorted(u.permission_codes()),
        totp_enabled=u.totp_enabled,
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
    except Unauthorized:
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
async def logout(request: Request, response: Response, user: CurrentUser, session: SessionDep) -> None:
    await service.logout(session, user, request.cookies.get(REFRESH_COOKIE))
    for c in (ACCESS_COOKIE, CSRF_COOKIE):
        response.delete_cookie(c, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser) -> MeOut:
    return _me(user)


class TotpConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=8)


@router.post("/totp/setup")
async def totp_setup(user: CurrentUser) -> dict[str, str]:
    return await service.begin_totp(user)


@router.post("/totp/confirm", status_code=204)
async def totp_confirm(body: TotpConfirm, user: CurrentUser, session: SessionDep) -> None:
    await service.confirm_totp(session, user, body.code)


__all__ = ["Depends", "router"]
