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


async def current_user(request: Request, session: SessionDep) -> User:
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
    with_user(user.id, user.username)
    request.state.user = user
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
