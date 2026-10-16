from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import User
from app.core.errors import Conflict, RuleViolation
from app.core.repository import get_or_404
from app.core.sequences import lead_number
from app.core.state_machine import lead_sm
from app.core.timeutil import now_utc, today_ist
from app.core.validators import normalize_email, normalize_name
from app.leads.models import Lead, LeadNote, LeadStatusHistory
from app.leads.schemas import LeadIn, LeadPatch, StatusIn
from app.members import duplicates

READ_ONLY_AFTER_CONVERSION = {"prospect_name", "mobile", "email", "member_id", "status"}


async def create(session: AsyncSession, data: LeadIn, user: User) -> Lead:
    matches = await duplicates.check(
        session,
        names_dobs=[(data.prospect_name, None)],
        mobiles=[data.mobile, data.whatsapp or ""],
        email=data.email,
        pans=[],
    )
    override = duplicates.enforce(
        matches, data.duplicate_override_reason, "lead.duplicate_override" in user.permission_codes()
    )
    entry = data.entry_date or today_ist()
    lead = Lead(
        lead_number=await lead_number(session, entry.year),
        entry_date=entry,
        prospect_name=data.prospect_name.strip(),
        name_norm=normalize_name(data.prospect_name),
        mobile=data.mobile,
        whatsapp=data.whatsapp,
        whatsapp_same_as_mobile=data.whatsapp_same_as_mobile,
        email=normalize_email(data.email),
        city=data.city,
        venue_id=data.venue_id,
        source_id=data.source_id,
        opc_name=data.opc_name,
        salesperson_id=data.salesperson_id,
        follow_up_date=data.follow_up_date,
        status="NEW",
        duplicate_override_reason=override,
        created_by=user.id,
        updated_by=user.id,
    )
    session.add(lead)
    await session.flush()
    session.add(LeadStatusHistory(lead_id=lead.id, from_status=None, to_status="NEW", changed_by=user.id))
    if data.note:
        session.add(LeadNote(lead_id=lead.id, note=data.note, created_by=user.id))
    if override:
        audit.record(
            session,
            "DUPLICATE_OVERRIDE",
            f"Lead {lead.lead_number} saved despite probable duplicate: {override}",
            entity_type="leads",
            entity_id=lead.id,
            entity_ref=lead.lead_number,
            changes={"matches": [m.ref for m in matches]},
        )
    await session.refresh(lead, ["notes"])
    return lead


async def update(session: AsyncSession, lead_id: uuid.UUID, data: LeadPatch, user: User) -> Lead:
    lead = await get_or_404(session, Lead, lead_id, label="Lead")
    if lead.version != data.version:
        raise Conflict("Lead was modified by someone else. Reload and retry.", code="VersionConflict")
    changes = data.model_dump(exclude_unset=True, exclude={"version"})
    if lead.status == "CONVERTED" and READ_ONLY_AFTER_CONVERSION & changes.keys():
        raise RuleViolation("Converted leads are read-only for identity and conversion fields", code="LeadConverted")
    if changes.get("whatsapp_same_as_mobile"):
        changes["whatsapp"] = changes.get("mobile", lead.mobile)
    for k, v in changes.items():
        setattr(lead, k, normalize_email(v) if k == "email" else v)
    if "prospect_name" in changes:
        lead.name_norm = normalize_name(lead.prospect_name)
    lead.updated_by = user.id
    await session.flush()
    return lead


async def change_status(session: AsyncSession, lead_id: uuid.UUID, data: StatusIn, user: User) -> Lead:
    lead = await get_or_404(session, Lead, lead_id, for_update=True, label="Lead")
    if data.status == "CONVERTED":
        raise RuleViolation("Use the Convert-to-member action to convert a lead", code="UseConversion")
    lead_sm.check(lead.status, data.status)
    if data.status == "PRESENTATION_SCHEDULED":
        if data.presentation_at is None:
            raise RuleViolation("Presentation date and time are required", code="PresentationAt")
        lead.presentation_at = data.presentation_at
    old = lead.status
    lead.status = data.status
    lead.updated_by = user.id
    session.add(
        LeadStatusHistory(lead_id=lead.id, from_status=old, to_status=data.status, changed_by=user.id, note=data.note)
    )
    audit.record(
        session,
        "STATUS_CHANGE",
        f"Lead {lead.lead_number}: {old} -> {data.status}",
        entity_type="leads",
        entity_id=lead.id,
        entity_ref=lead.lead_number,
        changes={"status": [old, data.status]},
    )
    await session.flush()
    return lead


async def add_note(session: AsyncSession, lead_id: uuid.UUID, note: str, user: User) -> LeadNote:
    lead = await get_or_404(session, Lead, lead_id, label="Lead")
    n = LeadNote(lead_id=lead.id, note=note, created_by=user.id)
    session.add(n)
    await session.flush()
    return n


def list_query(
    *,
    q: str | None,
    status: list[str] | None,
    venue_id: uuid.UUID | None,
    opc: str | None,
    salesperson_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    follow_up_due: bool,
) -> Select[Any]:
    stmt = select(Lead).where(Lead.deleted_at.is_(None))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(Lead.name_norm.like(like), Lead.lead_number.ilike(like), Lead.mobile.like(like), Lead.email.ilike(like))
        )
    if status:
        stmt = stmt.where(Lead.status.in_(status))
    if venue_id:
        stmt = stmt.where(Lead.venue_id == venue_id)
    if opc:
        stmt = stmt.where(Lead.opc_name.ilike(f"%{opc}%"))
    if salesperson_id:
        stmt = stmt.where(Lead.salesperson_id == salesperson_id)
    if date_from:
        stmt = stmt.where(Lead.entry_date >= date_from)
    if date_to:
        stmt = stmt.where(Lead.entry_date <= date_to)
    if follow_up_due:
        stmt = stmt.where(Lead.follow_up_date <= today_ist(), Lead.status.notin_(["CONVERTED", "NOT_INTERESTED"]))
    return stmt


async def follow_up_dashboard(session: AsyncSession) -> list[dict[str, Any]]:
    today = today_ist()
    rows = (
        await session.execute(
            select(
                Lead.salesperson_id,
                User.full_name,
                Lead.follow_up_date,
                Lead.id,
                Lead.lead_number,
                Lead.prospect_name,
                Lead.status,
            )
            .join(User, User.id == Lead.salesperson_id, isouter=True)
            .where(
                Lead.deleted_at.is_(None),
                Lead.follow_up_date <= today,
                Lead.status.notin_(["CONVERTED", "NOT_INTERESTED"]),
            )
            .order_by(User.full_name, Lead.follow_up_date)
        )
    ).all()
    out: dict[str, dict[str, Any]] = {}
    for sp_id, sp_name, fu, lid, num, name, st in rows:
        k = str(sp_id) if sp_id else "unassigned"
        b = out.setdefault(
            k, {"salesperson_id": sp_id, "salesperson": sp_name or "Unassigned", "due_today": [], "overdue": []}
        )
        (b["due_today"] if fu == today else b["overdue"]).append(
            {"id": lid, "lead_number": num, "prospect_name": name, "status": st, "follow_up_date": fu}
        )
    return list(out.values())


def mark_converted(lead: Lead, member_id: uuid.UUID, user: User, session: AsyncSession) -> None:
    lead_sm.check(lead.status, "CONVERTED")
    old = lead.status
    lead.status = "CONVERTED"
    lead.member_id = member_id
    lead.converted_at = now_utc()
    lead.updated_by = user.id
    session.add(
        LeadStatusHistory(
            lead_id=lead.id, from_status=old, to_status="CONVERTED", changed_by=user.id, note="Converted to member"
        )
    )
