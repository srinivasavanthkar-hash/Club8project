import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.audit.models import RecordVersion
from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.repository import get_or_404, paginate
from app.core.schemas import Page, PageParams
from app.leads.models import Lead
from app.members import duplicates, service
from app.members.models import Member, MemberApplicant, MemberStatusHistory
from app.members.schemas import (
    ApprovalCheck,
    KycReveal,
    MemberIn,
    MemberListItem,
    MemberOut,
    MemberPatch,
    StatusIn,
)
from app.search.service import member_search_clause

router = APIRouter(route_class=TransactionalRoute, tags=["members"])
SORTABLE = {
    "membership_number": Member.membership_number,
    "purchase_date": Member.purchase_date,
    "status": Member.status,
    "city": Member.city,
}


def _item(m: Member) -> MemberListItem:
    a1 = next((a for a in m.applicants if a.position == 1), None)
    return MemberListItem(
        id=m.id,
        membership_number=m.membership_number,
        status=m.status,
        company_id=m.company_id,
        email=m.email,
        city=m.city,
        purchase_date=m.purchase_date,
        applicant_name=a1.full_name if a1 else None,
        mobile=a1.mobile if a1 else None,
    )


@router.get("/members", response_model=Page[MemberListItem])
async def list_members(
    session: SessionDep,
    _: User = Depends(require_permission("member.view")),
    params: PageParams = Depends(),
    q: str | None = None,
    status: list[str] | None = Query(None),
    company_id: uuid.UUID | None = None,
    relationship_manager_id: uuid.UUID | None = None,
    purchase_from: date | None = None,
    purchase_to: date | None = None,
    custom_field: str | None = Query(None, description="key=value, matches custom fields"),
) -> Page[MemberListItem]:
    stmt = select(Member).where(Member.deleted_at.is_(None))
    if q:
        stmt = stmt.where(member_search_clause(q))
    if status:
        stmt = stmt.where(Member.status.in_(status))
    if company_id:
        stmt = stmt.where(Member.company_id == company_id)
    if relationship_manager_id:
        stmt = stmt.where(Member.relationship_manager_id == relationship_manager_id)
    if purchase_from:
        stmt = stmt.where(Member.purchase_date >= purchase_from)
    if purchase_to:
        stmt = stmt.where(Member.purchase_date <= purchase_to)
    if custom_field and "=" in custom_field:
        k, v = custom_field.split("=", 1)
        stmt = stmt.where(Member.custom_fields.contains({k: v}))
    items, total = await paginate(session, stmt, params, SORTABLE, [Member.purchase_date.desc()])
    return Page(items=[_item(m) for m in items], total=total, page=params.page, page_size=params.page_size)


@router.post("/members", response_model=MemberOut, status_code=201)
async def create_member(
    body: MemberIn, session: SessionDep, user: User = Depends(require_permission("member.create"))
) -> MemberOut:
    return MemberOut.model_validate(await service.create(session, body, user))


@router.get("/members/number-series")
async def number_series(
    session: SessionDep,
    company_id: uuid.UUID,
    purchase_date: date,
    venue_id: uuid.UUID | None = None,
    home_property_id: uuid.UUID | None = None,
    _: User = Depends(require_permission("member.create")),
) -> dict[str, Any]:
    """Membership number series that fit a new member (company, sales venue, home property, purchase date), most
    specific first, and the one to pre-select (null when none fits or two are equally specific)."""
    fits = await service.fitting_series(session, company_id, venue_id, home_property_id, purchase_date)
    default = service.default_series(fits)
    return {
        "items": [
            {
                "id": s.id,
                "prefix": s.prefix,
                "next_number": s.next_number,
                "venue_id": s.venue_id,
                "property_id": s.property_id,
                "to_be_confirmed": s.to_be_confirmed,
            }
            for s in fits
        ],
        "default_id": default.id if default else None,
    }


@router.get("/leads/{lead_id}/conversion-prefill")
async def prefill(
    lead_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("lead.convert"))
) -> dict[str, Any]:
    return service.prefill_from_lead(await get_or_404(session, Lead, lead_id, label="Lead"))


@router.post("/leads/{lead_id}/convert", response_model=MemberOut, status_code=201)
async def convert(
    lead_id: uuid.UUID,
    body: MemberIn,
    session: SessionDep,
    user: User = Depends(require_permission("lead.convert", "member.create")),
) -> MemberOut:
    return MemberOut.model_validate(await service.convert_lead(session, lead_id, body, user))


class DuplicateCheckIn(BaseModel):
    names: list[str] = []
    dobs: list[date | None] = []
    mobiles: list[str] = []
    email: str | None = None
    pans: list[str] = []


@router.post("/duplicates/check")
async def duplicate_check(
    body: DuplicateCheckIn, session: SessionDep, _: User = Depends(require_permission("lead.view"))
) -> list[dict[str, Any]]:
    dobs = body.dobs + [None] * (len(body.names) - len(body.dobs))
    matches = await duplicates.check(
        session,
        names_dobs=list(zip(body.names, dobs, strict=False)),
        mobiles=body.mobiles,
        email=body.email,
        pans=body.pans,
    )
    return [{"ref": m.ref, "kind": m.kind, "reasons": list(m.reasons), "hard": m.hard} for m in matches]


@router.get("/members/{member_id}", response_model=MemberOut)
async def get_member(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("member.view"))
) -> MemberOut:
    return MemberOut.model_validate(await get_or_404(session, Member, member_id, label="Member"))


@router.patch("/members/{member_id}", response_model=MemberOut)
async def update_member(
    member_id: uuid.UUID,
    body: MemberPatch,
    session: SessionDep,
    user: User = Depends(require_permission("member.update")),
) -> MemberOut:
    return MemberOut.model_validate(await service.update(session, member_id, body, user))


@router.get("/members/{member_id}/approval-check", response_model=ApprovalCheck)
async def approval_check(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("member.view"))
) -> ApprovalCheck:
    m = await get_or_404(session, Member, member_id, label="Member")
    b = await service.approval_blockers(session, m) if m.status == "PENDING_APPROVAL" else [f"Status is {m.status}"]
    return ApprovalCheck(can_approve=not b, blockers=b)


class ApproveIn(BaseModel):
    comments: str | None = None


@router.post("/members/{member_id}/approve", response_model=MemberOut)
async def approve(
    member_id: uuid.UUID,
    body: ApproveIn,
    session: SessionDep,
    user: User = Depends(require_permission("member.approve")),
) -> MemberOut:
    return MemberOut.model_validate(await service.approve(session, member_id, user, body.comments))


@router.post("/members/{member_id}/status", response_model=MemberOut)
async def change_status(
    member_id: uuid.UUID,
    body: StatusIn,
    session: SessionDep,
    user: User = Depends(require_permission("member.status.change")),
) -> MemberOut:
    return MemberOut.model_validate(await service.change_status(session, member_id, body.to_status, body.reason, user))


@router.get("/members/{member_id}/status-history")
async def status_history(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("member.view"))
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(MemberStatusHistory)
            .where(MemberStatusHistory.member_id == member_id)
            .order_by(MemberStatusHistory.changed_at)
        )
    ).scalars()
    return [
        {"from": r.from_status, "to": r.to_status, "at": r.changed_at, "by": r.changed_by, "reason": r.reason}
        for r in rows
    ]


@router.post("/kyc/{kyc_id}/reveal", response_model=KycReveal)
async def reveal(
    kyc_id: uuid.UUID, session: SessionDep, user: User = Depends(require_permission("kyc.view_full"))
) -> KycReveal:
    t, v = await service.reveal_kyc(session, kyc_id, user)
    return KycReveal(id_type=t, value=v)


@router.get("/history/{table}/{record_id}")
async def record_history(
    table: str, record_id: str, session: SessionDep, _: User = Depends(require_permission("member.view"))
) -> list[dict[str, Any]]:
    """Correction history of any business record: old/new values, who, when, reason."""
    rows = (
        await session.execute(
            select(RecordVersion)
            .where(RecordVersion.table_name == table, RecordVersion.record_id == record_id)
            .order_by(RecordVersion.id)
        )
    ).scalars()
    return [
        {
            "operation": r.operation,
            "changed_at": r.changed_at,
            "changed_by": r.changed_by,
            "reason": r.reason,
            "old": r.old_values,
            "new": r.new_values,
        }
        for r in rows
    ]


@router.get("/members/{member_id}/history")
async def member_history(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("member.view"))
) -> list[dict[str, Any]]:
    """History tab: every versioned change to this member and its child records."""
    rows = (
        await session.execute(
            select(RecordVersion)
            .where(RecordVersion.member_id == member_id)
            .order_by(RecordVersion.id.desc())
            .limit(1000)
        )
    ).scalars()
    return [
        {
            "table": r.table_name,
            "record_id": r.record_id,
            "operation": r.operation,
            "changed_at": r.changed_at,
            "changed_by": r.changed_by,
            "reason": r.reason,
            "old": r.old_values,
            "new": r.new_values,
        }
        for r in rows
    ]


__all__ = ["MemberApplicant", "router"]
