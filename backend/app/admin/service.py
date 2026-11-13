"""Master-data service: generic CRUD + effective-dated rate rules + users/roles."""

from __future__ import annotations

import secrets
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, create_model
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import models as m
from app.audit import service as audit
from app.auth.models import Permission, Role, User
from app.auth.policy import policy_problems, remember
from app.auth.recovery import TemporaryPassword, issue_temporary_password
from app.core.errors import Conflict, NotFound, OverrideRequired, RuleViolation
from app.core.security import hash_password
from app.core.settings_store import get_setting
from app.finance.domain import asf_rate_cap_check

# slug -> model. Every table here is editable in the admin UI (permission admin.masterdata or admin.rates).
MASTER: dict[str, type[Any]] = {
    "companies": m.Company,
    "resort-categories": m.ResortCategory,
    "seasons": m.Season,
    "season-calendar": m.SeasonCalendar,
    "unit-types": m.UnitType,
    "products": m.Product,
    "custom-fields": m.ProductCustomField,
    "joining-offer-types": m.JoiningOfferType,
    "tax-rates": m.TaxRate,
    "asf-rates": m.AsfRate,
    "deduction-matrix": m.DeductionMatrix,
    "cancellation-tiers": m.CancellationTier,
    "payment-types": m.PaymentType,
    "payment-methods": m.PaymentMethod,
    "currencies": m.Currency,
    "document-types": m.DocumentType,
    "venues": m.Venue,
    "lead-sources": m.LeadSource,
    "destinations": m.Destination,
    "properties": m.Property,
    "reasons": m.Reason,
    "holidays": m.HolidayCalendar,
    "statuses": m.StatusDefinition,
    "settings": m.SystemSetting,
    "letter-templates": m.LetterTemplate,
}
RATE_TABLES = {"tax-rates", "asf-rates", "deduction-matrix", "cancellation-tiers", "settings"}
SYSTEM_COLS = {"id", "version", "created_at", "updated_at", "created_by", "updated_by", "next_membership_seq"}

_schemas: dict[tuple[str, bool], type[BaseModel]] = {}


def schema_for(slug: str, partial: bool = False) -> type[BaseModel]:
    key = (slug, partial)
    if key in _schemas:
        return _schemas[key]
    model = MASTER[slug]
    fields: dict[str, Any] = {}
    for col in model.__table__.columns:
        if col.name in SYSTEM_COLS:
            continue
        try:
            py = col.type.python_type
        except NotImplementedError:
            py = Any
        if col.name in ("value", "options", "allowed_next", "allowed_tenures"):
            py = Any
        optional = partial or col.nullable or col.default is not None or col.server_default is not None
        fields[col.name] = ((py | None) if optional else py, None if optional else ...)
    cfg = ConfigDict(extra="forbid")
    _schemas[key] = create_model(
        f"{slug.title().replace('-', '')}{'Patch' if partial else 'In'}", __config__=cfg, **fields
    )
    return _schemas[key]


def to_dict(obj: Any) -> dict[str, Any]:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


async def list_items(session: AsyncSession, slug: str, include_inactive: bool) -> list[Any]:
    model = MASTER[slug]
    stmt = select(model)
    if not include_inactive and hasattr(model, "is_active"):
        stmt = stmt.where(model.is_active.is_(True))
    order = [
        getattr(model, c)
        for c in ("sort_order", "code", "effective_from", "key", "start_date", "holiday_date")
        if hasattr(model, c)
    ]
    return list((await session.execute(stmt.order_by(*order))).scalars())


async def _asf_checks(
    session: AsyncSession, data: dict[str, Any], can_override: bool, override_reason: str | None
) -> list[str]:
    prev = (
        await session.execute(
            select(m.AsfRate)
            .where(
                m.AsfRate.unit_type_id == data["unit_type_id"],
                m.AsfRate.company_id.is_(data.get("company_id"))
                if data.get("company_id") is None
                else m.AsfRate.company_id == data["company_id"],
                m.AsfRate.effective_from < data["effective_from"],
            )
            .order_by(m.AsfRate.effective_from.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    cap = Decimal(str(await get_setting(session, "asf.annual_cap_percent")))
    warning = asf_rate_cap_check(prev.amount if prev else None, Decimal(str(data["amount"])), cap)
    if warning:
        if not override_reason:
            raise OverrideRequired(warning, code="AsfCapExceeded")
        if not can_override:
            raise RuleViolation(
                "Permission admin.rates.override_cap is required to exceed the cap", code="AsfCapPermission"
            )
        data["override_reason"] = override_reason
    if prev and prev.effective_to is None:
        prev.effective_to = data["effective_from"] - timedelta(days=1)
    return [warning] if warning else []


async def _close_previous(session: AsyncSession, model: type[Any], data: dict[str, Any], match: list[str]) -> None:
    """Effective-dated tables: close the currently-open row(s) with the same key."""
    if "effective_from" not in data:
        return
    stmt = select(model).where(model.effective_to.is_(None), model.effective_from < data["effective_from"])
    for col in match:
        v = data.get(col)
        stmt = stmt.where(getattr(model, col).is_(None) if v is None else getattr(model, col) == v)
    for row in (await session.execute(stmt)).scalars():
        row.effective_to = data["effective_from"] - timedelta(days=1)


async def create_item(
    session: AsyncSession, slug: str, payload: dict[str, Any], user: User, override_reason: str | None = None
) -> tuple[Any, list[str]]:
    model = MASTER[slug]
    data = schema_for(slug)(**payload).model_dump(exclude_unset=False)
    warnings: list[str] = []
    if slug == "asf-rates":
        warnings = await _asf_checks(
            session, data, "admin.rates.override_cap" in user.permission_codes(), override_reason
        )
    elif slug == "tax-rates":
        await _close_previous(session, model, data, ["code"])
    elif slug == "cancellation-tiers":
        if data.get("max_days") is not None and data["max_days"] < data["min_days"]:
            raise RuleViolation("max_days must be >= min_days", code="TierBounds")
    elif slug == "deduction-matrix":
        await _close_previous(
            session,
            model,
            data,
            [
                "booked_category",
                "booked_season",
                "booked_unit_type",
                "purchased_category",
                "purchased_season",
                "purchased_unit_type",
            ],
        )
    if slug == "payment-methods" and str(data.get("code", "")).upper() == "CASH" and data.get("is_active"):
        warnings.append("The membership agreement states that no cash payments are accepted")
    obj = model(**{k: v for k, v in data.items() if v is not None or k in payload})
    obj.created_by = obj.updated_by = user.id
    session.add(obj)
    await session.flush()
    if slug in RATE_TABLES:
        audit.record(
            session,
            "RATE_CHANGE",
            f"{slug} entry created" + (f" (override: {override_reason})" if override_reason else ""),
            entity_type=model.__tablename__,
            entity_id=obj.id,
        )
    return obj, warnings


async def update_item(
    session: AsyncSession, slug: str, id_: uuid.UUID, payload: dict[str, Any], user: User, expected_version: int | None
) -> Any:
    model = MASTER[slug]
    obj = await session.get(model, id_, with_for_update=True)
    if obj is None:
        raise NotFound(f"{slug} item not found")
    if expected_version is not None and obj.version != expected_version:
        raise Conflict("Record was modified by someone else", code="VersionConflict")
    data = schema_for(slug, partial=True)(**payload).model_dump(exclude_unset=True)
    if slug == "asf-rates" and {"amount", "effective_from"} & data.keys():
        raise RuleViolation(
            "ASF rates are effective-dated: add a new rate instead of editing amounts", code="RateImmutable"
        )
    if slug == "payment-methods" and obj.code == "CASH" and data.get("is_active"):
        audit.record(
            session,
            "MASTERDATA_POLICY",
            "Cash payment method enabled despite agreement clause",
            entity_type="payment_methods",
            entity_id=obj.id,
        )
    for k, v in data.items():
        setattr(obj, k, v)
    obj.updated_by = user.id
    if slug in RATE_TABLES:
        audit.record(session, "RATE_CHANGE", f"{slug} entry updated", entity_type=model.__tablename__, entity_id=obj.id)
    await session.flush()
    return obj


# ---------------------------------------------------------------- users / roles
async def create_user(
    session: AsyncSession,
    username: str,
    full_name: str,
    role_codes: list[str],
    email: str | None = None,
    mobile: str | None = None,
    *,
    password: str | None = None,
) -> tuple[User, TemporaryPassword | None]:
    """Admins never type a password for anyone: without `password` (always, from the API) the system generates a
    temporary one, shown once to the admin, valid for 24 h and to be changed at first sign-in.

    `password` is for internal provisioning only (tests, scripted set-up). It is checked against the policy and does
    not force a change."""
    if (await session.execute(select(User).where(User.username == username.lower()))).scalar_one_or_none():
        raise Conflict("Username already exists", code="UsernameTaken")
    roles = list((await session.execute(select(Role).where(Role.code.in_(role_codes)))).scalars())
    if len(roles) != len(set(role_codes)):
        raise RuleViolation("Unknown role code", code="UnknownRole")
    if password is not None:
        problems = await policy_problems(session, password, username=username.lower(), full_name=full_name)
        if problems:
            raise RuleViolation(" ".join(p.message for p in problems), code="PasswordPolicy")
    u = User(
        username=username.lower(),
        full_name=full_name,
        password_hash=hash_password(password or secrets.token_urlsafe(32)),  # replaced below when generated
        email=email,
        mobile=mobile,
        roles=roles,
        must_change_password=password is None,
    )
    session.add(u)
    await session.flush()
    audit.record(
        session,
        "PERMISSION_CHANGE",
        f"User {u.username} created with roles {sorted(role_codes)}",
        entity_type="users",
        entity_id=u.id,
        entity_ref=u.username,
    )
    if password is not None:
        u.password_changed_at = u.created_at
        await remember(session, u.id, u.password_hash, int(await get_setting(session, "password.history_count")))
        return u, None
    return u, await issue_temporary_password(session, u, why="new user", end_sessions=False)


async def set_user_roles(session: AsyncSession, user_id: uuid.UUID, role_codes: list[str]) -> User:
    u = await session.get(User, user_id)
    if u is None:
        raise NotFound("User not found")
    before = sorted(r.code for r in u.roles)
    u.roles = list((await session.execute(select(Role).where(Role.code.in_(role_codes)))).scalars())
    audit.record(
        session,
        "PERMISSION_CHANGE",
        f"Roles for {u.username} changed",
        entity_type="users",
        entity_id=u.id,
        entity_ref=u.username,
        changes={"roles": [before, sorted(role_codes)]},
    )
    return u


async def set_role_permissions(session: AsyncSession, role_code: str, perm_codes: list[str]) -> Role:
    role = (await session.execute(select(Role).where(Role.code == role_code))).scalar_one_or_none()
    if role is None:
        raise NotFound("Role not found")
    perms = list((await session.execute(select(Permission).where(Permission.code.in_(perm_codes)))).scalars())
    if len(perms) != len(set(perm_codes)):
        raise RuleViolation("Unknown permission code", code="UnknownPermission")
    before = sorted(p.code for p in role.permissions)
    role.permissions = perms
    audit.record(
        session,
        "PERMISSION_CHANGE",
        f"Permissions for role {role.code} changed",
        entity_type="roles",
        entity_id=role.id,
        entity_ref=role.code,
        changes={"permissions": [before, sorted(perm_codes)]},
    )
    return role


async def effective_rate(session: AsyncSession, model: type[Any], on: date, **match: Any) -> Any:
    stmt = select(model).where(model.effective_from <= on, (model.effective_to.is_(None)) | (model.effective_to >= on))
    for k, v in match.items():
        stmt = stmt.where(getattr(model, k) == v)
    return (await session.execute(stmt.order_by(model.effective_from.desc()).limit(1))).scalar_one_or_none()
