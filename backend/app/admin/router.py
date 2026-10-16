import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.admin import service
from app.auth.models import Permission, Role, User
from app.core.db import TransactionalRoute
from app.core.deps import CurrentUser, SessionDep, has_permission, require_permission
from app.core.errors import Forbidden, NotFound

router = APIRouter(route_class=TransactionalRoute, prefix="/admin", tags=["admin"])


def _guard(slug: str, user: User, write: bool) -> None:
    if slug not in service.MASTER:
        raise NotFound(f"Unknown master data '{slug}'")
    if not write:
        return
    if slug in service.RATE_TABLES:
        need = "admin.rates"
    elif slug == "custom-fields":
        need = "admin.customfields"
    elif slug == "letter-templates":
        need = "admin.templates"
    else:
        need = "admin.masterdata"
    if not has_permission(user, need):
        raise Forbidden(f"Missing permission: {need}", code="PermissionDenied")


@router.get("/master/{slug}")
async def list_master(
    slug: str, user: CurrentUser, session: SessionDep, include_inactive: bool = Query(False)
) -> list[dict[str, Any]]:
    """Read access to master data is available to every signed-in user (dropdowns)."""
    _guard(slug, user, write=False)
    return [service.to_dict(o) for o in await service.list_items(session, slug, include_inactive)]


@router.post("/master/{slug}", status_code=201)
async def create_master(
    slug: str,
    user: CurrentUser,
    session: SessionDep,
    payload: dict[str, Any] = Body(...),
    x_override_reason: str | None = Header(None),
) -> dict[str, Any]:
    _guard(slug, user, write=True)
    obj, warnings = await service.create_item(session, slug, payload, user, x_override_reason)
    return {**service.to_dict(obj), "_warnings": warnings}


@router.patch("/master/{slug}/{item_id}")
async def update_master(
    slug: str,
    item_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    payload: dict[str, Any] = Body(...),
    if_match: int | None = Header(None),
) -> dict[str, Any]:
    _guard(slug, user, write=True)
    return service.to_dict(await service.update_item(session, slug, item_id, payload, user, if_match))


# ---------------------------------------------------------------- users & roles
class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=12, max_length=200)
    roles: list[str]
    email: str | None = None
    mobile: str | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    is_active: bool
    roles: list[str]


def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        username=u.username,
        full_name=u.full_name,
        is_active=u.is_active,
        roles=sorted(r.code for r in u.roles),
    )


@router.get("/users", response_model=list[UserOut])
async def list_users(session: SessionDep, _: User = Depends(require_permission("admin.users"))) -> list[UserOut]:
    return [_user_out(u) for u in (await session.execute(select(User).order_by(User.username))).scalars()]


@router.get("/staff", response_model=list[UserOut])
async def list_staff(session: SessionDep, _: CurrentUser) -> list[UserOut]:
    """Active staff for dropdowns (salesperson, relationship/team manager)."""
    rows = (await session.execute(select(User).where(User.is_active.is_(True)).order_by(User.full_name))).scalars()
    return [_user_out(u) for u in rows]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    body: UserIn, session: SessionDep, _: User = Depends(require_permission("admin.users"))
) -> UserOut:
    return _user_out(
        await service.create_user(
            session, body.username, body.full_name, body.password, body.roles, body.email, body.mobile
        )
    )


class RolesIn(BaseModel):
    roles: list[str]


@router.put("/users/{user_id}/roles", response_model=UserOut)
async def set_roles(
    user_id: uuid.UUID, body: RolesIn, session: SessionDep, _: User = Depends(require_permission("admin.roles"))
) -> UserOut:
    return _user_out(await service.set_user_roles(session, user_id, body.roles))


class ActiveIn(BaseModel):
    is_active: bool


@router.put("/users/{user_id}/active", response_model=UserOut)
async def set_active(
    user_id: uuid.UUID, body: ActiveIn, session: SessionDep, _: User = Depends(require_permission("admin.users"))
) -> UserOut:
    u = await session.get(User, user_id)
    if u is None:
        raise NotFound("User not found")
    u.is_active = body.is_active
    if body.is_active:
        u.failed_logins, u.locked_until = 0, None
    return _user_out(u)


@router.get("/roles")
async def list_roles(session: SessionDep, _: User = Depends(require_permission("admin.roles"))) -> list[dict[str, Any]]:
    roles = (await session.execute(select(Role).order_by(Role.code))).scalars()
    return [{"code": r.code, "name": r.name, "permissions": sorted(p.code for p in r.permissions)} for r in roles]


@router.get("/permissions")
async def list_permissions(
    session: SessionDep, _: User = Depends(require_permission("admin.roles"))
) -> list[dict[str, str]]:
    rows = (await session.execute(select(Permission).order_by(Permission.code))).scalars()
    return [{"code": p.code, "description": p.description} for p in rows]


class PermsIn(BaseModel):
    permissions: list[str]


@router.put("/roles/{code}/permissions")
async def set_permissions(
    code: str, body: PermsIn, session: SessionDep, _: User = Depends(require_permission("admin.roles"))
) -> dict[str, Any]:
    r = await service.set_role_permissions(session, code, body.permissions)
    return {"code": r.code, "permissions": sorted(p.code for p in r.permissions)}
