"""FastAPI dependencies: DB session, current user, permission enforcement."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.context import with_user
from app.core.db import get_session
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_token

ACCESS_COOKIE = "crm_access"
REFRESH_COOKIE = "crm_refresh"
CSRF_COOKIE = "crm_csrf"

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def authenticated_user(request: Request, session: SessionDep) -> User:
    """A valid session, even if the account still has to change its password or enrol 2FA.

    Only the account-setup routes (/auth/me, /auth/logout, /auth/change-password, /auth/totp/*) use this directly;
    everything else goes through `current_user`."""
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else None
    if not token:
        raise Unauthorized("Not signed in", code="NotAuthenticated")
    try:
        data = decode_token(token, "access")
    except jwt.PyJWTError as e:
        raise Unauthorized("Session expired or invalid", code="TokenInvalid") from e
    user = (await session.execute(select(User).where(User.id == data["sub"]))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise Unauthorized("User inactive", code="UserInactive")
    # Token version: a password change/reset, "sign out everywhere" or 2FA reset increments users.token_version,
    # which ends every outstanding access token at once. The row is loaded anyway, so this costs no extra query.
    if data.get("tv", 0) != user.token_version:
        raise Unauthorized("Your session has ended. Sign in again.", code="SessionRevoked")
    with_user(user.id, user.username)
    request.state.user = user
    request.state.mfa = bool(data.get("mfa"))  # this session passed two-step verification
    return user


AccountUser = Annotated[User, Depends(authenticated_user)]


async def current_user(user: AccountUser) -> User:
    """A signed-in user who may use the app: nothing else is reachable until a forced change is done."""
    if user.must_change_password:
        raise Forbidden("Change your password to continue.", code="PasswordChangeRequired")
    if user.must_enroll_totp:
        raise Forbidden("Set up two-step verification to continue.", code="TotpEnrolmentRequired")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_permission(*codes: str) -> Callable[..., Coroutine[Any, Any, User]]:
    """All listed permissions are required. FastAPI is the sole enforcer of permissions."""

    async def _dep(user: CurrentUser) -> User:
        have = user.permission_codes()
        missing = [c for c in codes if c not in have]
        if missing:
            raise Forbidden(
                f"Missing permission: {', '.join(missing)}", code="PermissionDenied", extra={"missing": missing}
            )
        return user

    return _dep


def has_permission(user: User, code: str) -> bool:
    return code in user.permission_codes()
