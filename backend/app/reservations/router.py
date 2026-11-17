import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.admin.models import DocumentType
from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.repository import get_or_404, paginate
from app.core.schemas import Page, PageParams
from app.correspondence.models import Document, DocumentLink
from app.entitlement import service as ent_service
from app.finance import service as fin
from app.finance.models import AsfCharge, Payment, ReservationAsfLink
from app.members.models import Member
from app.reservations import service
from app.reservations.models import Reservation
from app.reservations.schemas import (
    Quote,
    RescheduleIn,
    ReservationDetail,
    ReservationIn,
    ReservationOut,
    StatusChangeIn,
)

router = APIRouter(route_class=TransactionalRoute, tags=["reservations"])
SORTABLE = {
    "check_in": Reservation.check_in,
    "request_date": Reservation.request_date,
    "reservation_number": Reservation.reservation_number,
    "status": Reservation.status,
}


@router.post("/members/{member_id}/reservations/quote", response_model=Quote)
async def quote(
    member_id: uuid.UUID,
    body: ReservationIn,
    session: SessionDep,
    _: User = Depends(require_permission("reservation.create")),
) -> Quote:
    """Live entitlement calculation shown to the user before submitting."""
    member = await get_or_404(session, Member, member_id, label="Member")
    q = await service.quote(session, member, body)
    if member.status != "ACTIVE":
        q.blocking.append(f"Member status is {member.status}; reservations need an ACTIVE member")
    return Quote(**q.as_dict())


@router.post("/members/{member_id}/reservations", response_model=ReservationOut, status_code=201)
async def create(
    member_id: uuid.UUID,
    body: ReservationIn,
    session: SessionDep,
    user: User = Depends(require_permission("reservation.create")),
) -> ReservationOut:
    return ReservationOut.model_validate(await service.create(session, member_id, body, user))


@router.get("/reservations", response_model=Page[ReservationOut])
async def list_reservations(
    session: SessionDep,
    _: User = Depends(require_permission("reservation.view")),
    params: PageParams = Depends(),
    member_id: uuid.UUID | None = None,
    status: list[str] | None = Query(None),
    check_in_from: date | None = None,
    check_in_to: date | None = None,
) -> Page[ReservationOut]:
    stmt = select(Reservation).where(Reservation.deleted_at.is_(None))
    if member_id:
        stmt = stmt.where(Reservation.member_id == member_id)
    if status:
        stmt = stmt.where(Reservation.status.in_(status))
    if check_in_from:
        stmt = stmt.where(Reservation.check_in >= check_in_from)
    if check_in_to:
        stmt = stmt.where(Reservation.check_in <= check_in_to)
    items, total = await paginate(session, stmt, params, SORTABLE, [Reservation.check_in.desc()])
    return Page(
        items=[ReservationOut.model_validate(i) for i in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/reservations/{reservation_id}", response_model=ReservationDetail)
async def get_reservation(
    reservation_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("reservation.view"))
) -> ReservationDetail:
    r = await get_or_404(session, Reservation, reservation_id, label="Reservation")
    charges = (
        await session.execute(
            select(AsfCharge)
            .join(ReservationAsfLink, ReservationAsfLink.asf_charge_id == AsfCharge.id)
            .where(ReservationAsfLink.reservation_id == r.id)
            .order_by(AsfCharge.membership_year)
        )
    ).scalars()
    d = await ent_service.active_deduction(session, r.id)
    pays = (await session.execute(select(Payment).where(Payment.reservation_id == r.id))).scalars()
    docs = (
        await session.execute(
            select(Document, DocumentType.code)
            .join(DocumentLink, DocumentLink.document_id == Document.id)
            .join(DocumentType, DocumentType.id == Document.document_type_id)
            .where(
                DocumentLink.entity_type == "RESERVATION",
                DocumentLink.entity_id == r.id,
                Document.deleted_at.is_(None),
            )
            .order_by(Document.created_at)
        )
    ).all()
    return ReservationDetail(
        reservation=ReservationOut.model_validate(r),
        unpaid_asf_years=await fin.unpaid_asf_years(session, r.id),
        asf_charges=[
            {
                "id": str(c.id),
                "membership_year": c.membership_year,
                "total": str(c.total_amount),
                "base": str(c.base_amount),
                "gst": str(c.gst_amount),
                "status": c.status,
                "currency": c.currency,
                "withdrawn_on": c.withdrawn_on.isoformat() if c.withdrawn_on else None,
                "withdrawn_reason": c.withdrawn_reason,
            }
            for c in charges
        ],
        deduction={"state": d.state, "plan": d.plan, "revision": d.revision} if d else None,
        payments=[
            {
                "id": str(p.id),
                "receipt_number": p.receipt_number,
                "type": p.payment_type_code,
                "total": str(p.total_amount),
                "currency": p.currency,
            }
            for p in pays
        ],
        documents=[
            {
                "id": str(d.id),
                "type": code,
                "file_name": d.file_name,
                "created_at": d.created_at.isoformat(),
                "voided_at": d.voided_at.isoformat() if d.voided_at else None,
                "void_reason": d.void_reason,
            }
            for d, code in docs
        ],
    )


@router.post("/reservations/{reservation_id}/status")
async def change_status(
    reservation_id: uuid.UUID,
    body: StatusChangeIn,
    session: SessionDep,
    user: User = Depends(require_permission("reservation.status.change")),
) -> dict[str, Any]:
    r, extra = await service.change_status(session, reservation_id, body, user)
    asf_withdrawn = extra.pop("asf_withdrawn", [])
    return {"reservation": ReservationOut.model_validate(r), "entitlement": extra, "asf_withdrawn": asf_withdrawn}


@router.get("/reservations/{reservation_id}/cancellation-terms")
async def cancellation_terms(
    reservation_id: uuid.UUID,
    session: SessionDep,
    _: User = Depends(require_permission("reservation.status.change")),
    communication_ref: str | None = Query(None, pattern=r"^(email|document):[0-9a-f-]{36}$"),
    cancel_date: date | None = None,
    cancel_date_reason: str | None = Query(None, max_length=500),
) -> dict[str, Any]:
    """What cancelling would do: notice date and its source, tier, nights credited and forfeited, ASF withdrawn.
    Changes nothing; the same rules are checked again when the reservation is cancelled."""
    return await service.cancellation_terms(session, reservation_id, communication_ref, cancel_date, cancel_date_reason)


@router.post("/reservations/{reservation_id}/reschedule", response_model=ReservationOut)
async def reschedule(
    reservation_id: uuid.UUID,
    body: RescheduleIn,
    session: SessionDep,
    user: User = Depends(require_permission("reservation.update")),
) -> ReservationOut:
    return ReservationOut.model_validate(await service.reschedule(session, reservation_id, body, user))
