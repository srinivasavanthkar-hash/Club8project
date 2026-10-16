import uuid
from dataclasses import asdict
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.repository import get_or_404
from app.core.timeutil import today_ist
from app.entitlement import service
from app.entitlement.models import EntitlementLedger
from app.members.models import Member
from app.reservations.models import Reservation

router = APIRouter(route_class=TransactionalRoute, tags=["entitlement"])


def _s(d: dict[str, Any]) -> dict[str, Any]:
    return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in d.items()}


@router.get("/members/{member_id}/entitlement")
async def entitlement(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("entitlement.view"))
) -> dict[str, Any]:
    member = await get_or_404(session, Member, member_id, label="Member")
    today = today_ist()
    years = [_s(asdict(v)) for v in await service.view(session, member, today)]
    res = (
        (
            await session.execute(
                select(Reservation)
                .where(Reservation.member_id == member.id, Reservation.deleted_at.is_(None))
                .order_by(Reservation.check_in)
            )
        )
        .scalars()
        .all()
    )

    def brief(r: Reservation) -> dict[str, Any]:
        return {
            "id": str(r.id),
            "reservation_number": r.reservation_number,
            "check_in": r.check_in,
            "check_out": r.check_out,
            "status": r.status,
            "entitlement_nights": str(r.entitlement_nights),
        }

    return {
        "years": years,
        "past": [brief(r) for r in res if r.check_out < today],
        "upcoming": [brief(r) for r in res if r.check_out >= today],
    }


@router.get("/members/{member_id}/entitlement/ledger")
async def ledger(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("entitlement.view"))
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(EntitlementLedger)
            .where(EntitlementLedger.member_id == member_id)
            .order_by(EntitlementLedger.created_at)
        )
    ).scalars()
    return [
        {
            "id": str(r.id),
            "origin_year": r.origin_year,
            "use_year": r.use_year,
            "entry_type": r.entry_type,
            "delta": str(r.delta),
            "reservation_id": str(r.reservation_id) if r.reservation_id else None,
            "note": r.note,
            "created_at": r.created_at,
        }
        for r in rows
    ]


class AdjustIn(BaseModel):
    year: int
    delta: Decimal = Field(max_digits=5, decimal_places=1)
    reason: str = Field(min_length=5, max_length=500)


@router.post("/members/{member_id}/entitlement/adjustments", status_code=201)
async def adjust(
    member_id: uuid.UUID,
    body: AdjustIn,
    session: SessionDep,
    user: User = Depends(require_permission("entitlement.adjust")),
) -> dict[str, str]:
    member = await get_or_404(session, Member, member_id, label="Member")
    await service.manual_adjust(session, member, body.year, body.delta, body.reason, user)
    return {"status": "ok"}
