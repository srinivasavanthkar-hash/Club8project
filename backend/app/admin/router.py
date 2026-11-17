import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, Header, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.admin import service
from app.auth import recovery
from app.auth.models import Permission, Role, User
from app.core.db import TransactionalRoute
from app.core.deps import CurrentUser, SessionDep, has_permission, require_permission
from app.core.errors import DomainError, Forbidden, NotFound
from app.core.timeutil import now_utc

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
    # No password field: the system generates a temporary one (admins never type passwords for anyone).
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=150)
    roles: list[str]
    email: str | None = None
    mobile: str | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    is_active: bool
    roles: list[str]
    totp_enabled: bool = False
    must_change_password: bool = False
    must_enroll_totp: bool = False
    locked: bool = False
    has_email: bool = False


def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        username=u.username,
        full_name=u.full_name,
        is_active=u.is_active,
        roles=sorted(r.code for r in u.roles),
        totp_enabled=u.totp_enabled,
        must_change_password=u.must_change_password,
        must_enroll_totp=u.must_enroll_totp,
        locked=bool(u.locked_until and u.locked_until > now_utc()),
        has_email=bool(u.email),
    )


class TemporaryPasswordOut(BaseModel):
    """Returned exactly once. Responses carry Cache-Control: no-store (SecurityHeadersMiddleware)."""

    temporary_password: str
    expires_at: datetime


class UserCreatedOut(UserOut):
    temporary_password: str
    temporary_password_expires_at: datetime


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 5:
            raise ValueError("Give a reason of at least 5 characters")
        return v


class ResetIn(ReasonIn):
    # option A: email a reset link to the registered address; option B: system-generated temporary password
    method: Literal["EMAIL_LINK", "TEMP_PASSWORD"] = "TEMP_PASSWORD"


class ResetOut(BaseModel):
    status: Literal["RESET", "LINK_SENT", "PENDING_APPROVAL"]
    link_sent_to: str | None = None
    temporary_password: str | None = None
    expires_at: datetime | None = None
    request_id: uuid.UUID | None = None
    approval_expires_at: datetime | None = None
    super_admin_fallback: bool = False


def _reset_out(o: recovery.ResetOutcome) -> ResetOut:
    if o.request is not None:
        return ResetOut(status="PENDING_APPROVAL", request_id=o.request.id, approval_expires_at=o.request.expires_at)
    if o.link_sent_to is not None:
        return ResetOut(status="LINK_SENT", link_sent_to=o.link_sent_to, super_admin_fallback=o.super_admin)
    assert o.temporary is not None
    return ResetOut(
        status="RESET",
        temporary_password=o.temporary.password,
        expires_at=o.temporary.expires_at,
        super_admin_fallback=o.super_admin,
    )


class ResetRequestOut(BaseModel):
    id: uuid.UUID
    target_username: str
    target_full_name: str
    requested_by: str
    requested_by_id: uuid.UUID
    method: str
    reason: str
    created_at: datetime
    expires_at: datetime


@router.get("/users", response_model=list[UserOut])
async def list_users(session: SessionDep, _: User = Depends(require_permission("admin.users"))) -> list[UserOut]:
    return [_user_out(u) for u in (await session.execute(select(User).order_by(User.username))).scalars()]


@router.get("/staff", response_model=list[UserOut])
async def list_staff(session: SessionDep, _: CurrentUser) -> list[UserOut]:
    """Active staff for dropdowns (salesperson, relationship/team manager)."""
    rows = (await session.execute(select(User).where(User.is_active.is_(True)).order_by(User.full_name))).scalars()
    return [_user_out(u) for u in rows]


@router.post("/users", response_model=UserCreatedOut, status_code=201)
async def create_user(
    body: UserIn, session: SessionDep, _: User = Depends(require_permission("admin.users"))
) -> UserCreatedOut:
    u, temp = await service.create_user(session, body.username, body.full_name, body.roles, body.email, body.mobile)
    assert temp is not None
    return UserCreatedOut(
        **_user_out(u).model_dump(),
        temporary_password=temp.password,
        temporary_password_expires_at=temp.expires_at,
    )


@router.post("/users/{user_id}/reset-password", response_model=ResetOut)
async def reset_password(
    user_id: uuid.UUID,
    body: ResetIn,
    session: SessionDep,
    actor: User = Depends(require_permission("user.reset_password")),
) -> ResetOut:
    """Option A (reset link by email) or B (temporary password, shown once). Non-admin target: done now.
    ADMIN target: a request that a different admin must approve."""
    return _reset_out(await recovery.reset_password(session, actor, user_id, body.reason, body.method))


@router.post("/users/{user_id}/reset-2fa", response_model=UserOut)
async def reset_2fa(
    user_id: uuid.UUID, body: ReasonIn, session: SessionDep, actor: User = Depends(require_permission("user.reset_2fa"))
) -> UserOut:
    return _user_out(await recovery.reset_totp(session, actor, user_id, body.reason))


@router.get("/reset-requests", response_model=list[ResetRequestOut])
async def list_reset_requests(
    session: SessionDep, _: User = Depends(require_permission("user.reset_password"))
) -> list[ResetRequestOut]:
    return [
        ResetRequestOut(
            id=r.id,
            target_username=t.username,
            target_full_name=t.full_name,
            requested_by=q.username,
            requested_by_id=q.id,
            method=r.method,
            reason=r.reason,
            created_at=r.created_at,
            expires_at=r.expires_at,
        )
        for r, t, q in await recovery.pending_requests(session)
    ]


@router.post("/reset-requests/{request_id}/approve", response_model=ResetOut)
async def approve_reset_request(
    request_id: uuid.UUID,
    body: ReasonIn,
    session: SessionDep,
    actor: User = Depends(require_permission("user.reset_password")),
) -> ResetOut:
    try:
        return _reset_out(await recovery.approve_request(session, actor, request_id, body.reason))
    except DomainError:
        await session.commit()  # keep an expiry discovered on the way (status + activity log entry)
        raise


@router.post("/reset-requests/{request_id}/reject", status_code=204)
async def reject_reset_request(
    request_id: uuid.UUID,
    body: ReasonIn,
    session: SessionDep,
    actor: User = Depends(require_permission("user.reset_password")),
) -> None:
    try:
        await recovery.reject_request(session, actor, request_id, body.reason)
    except DomainError:
        await session.commit()  # keep an expiry discovered on the way (status + activity log entry)
        raise


class RolesIn(ReasonIn):
    roles: list[str] = Field(min_length=1)


@router.put("/users/{user_id}/roles", response_model=UserOut)
async def set_roles(
    user_id: uuid.UUID, body: RolesIn, session: SessionDep, _: User = Depends(require_permission("admin.roles"))
) -> UserOut:
    return _user_out(await service.set_user_roles(session, user_id, body.roles, body.reason))


class SecurityPolicyOut(BaseModel):
    require_2fa_roles: list[str]
    recommended_2fa_roles: list[str] = ["ADMIN", "MANAGEMENT", "FINANCE"]


class SecurityPolicyIn(ReasonIn):
    require_2fa_roles: list[str]


@router.get("/security-policy", response_model=SecurityPolicyOut)
async def get_security_policy(
    session: SessionDep, _: User = Depends(require_permission("admin.users"))
) -> SecurityPolicyOut:
    from app.core.settings_store import get_setting

    return SecurityPolicyOut(require_2fa_roles=sorted(await get_setting(session, service.REQUIRE_2FA_KEY)))


@router.put("/security-policy", response_model=SecurityPolicyOut)
async def set_security_policy(
    body: SecurityPolicyIn, session: SessionDep, _: User = Depends(require_permission("admin.users"))
) -> SecurityPolicyOut:
    return SecurityPolicyOut(
        require_2fa_roles=await service.set_required_2fa_roles(session, body.require_2fa_roles, body.reason)
    )


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
