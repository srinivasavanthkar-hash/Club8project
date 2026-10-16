"""Home dashboard: one call, each widget shown only if the user has the permission."""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.db import TransactionalRoute
from app.core.deps import CurrentUser, SessionDep
from app.core.timeutil import today_ist
from app.finance import service as fin
from app.leads import service as lead_service
from app.members.models import Member
from app.reservations.models import Reservation

router = APIRouter(route_class=TransactionalRoute, tags=["dashboard"])


@router.get("/dashboard")
async def dashboard(user: CurrentUser, session: SessionDep) -> dict[str, Any]:
    perms = user.permission_codes()
    today = today_ist()
    out: dict[str, Any] = {}
    if "lead.view" in perms:
        out["follow_ups"] = await lead_service.follow_up_dashboard(session)
    if "member.view" in perms:
        out["approvals_pending"] = [
            {"id": str(m.id), "membership_number": m.membership_number, "purchase_date": m.purchase_date}
            for m in (
                await session.execute(
                    select(Member)
                    .where(Member.status == "PENDING_APPROVAL", Member.deleted_at.is_(None))
                    .order_by(Member.created_at)
                    .limit(50)
                )
            ).scalars()
        ]
    if "finance.view" in perms:
        fd = await fin.dashboard(session, None, None, None)
        out["overdue_emis"] = fd["overdue_emis"][:50]
        out["overdue_asf"] = fd["reservations_waiting_asf"][:50]
        out["default_notices_expiring"] = [n for n in fd["default_notices"] if n["days_remaining"] <= 7]
    if "reservation.view" in perms:
        out["upcoming_check_ins"] = [
            {"id": str(r.id), "reservation_number": r.reservation_number, "check_in": r.check_in, "status": r.status}
            for r in (
                await session.execute(
                    select(Reservation)
                    .where(
                        Reservation.check_in.between(today, today + timedelta(days=14)),
                        Reservation.status.in_(["CONFIRMED", "APPROVED", "RESCHEDULED"]),
                    )
                    .order_by(Reservation.check_in)
                    .limit(50)
                )
            ).scalars()
        ]
        out["pending_reservations"] = (
            await session.execute(select(func.count()).where(Reservation.status == "REQUESTED"))
        ).scalar_one()
    return out
