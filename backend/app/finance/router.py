import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.money import ZERO
from app.core.repository import get_or_404
from app.finance import service
from app.finance.models import DefaultNotice, Payment, PaymentAllocation, PaymentSchedule
from app.finance.schemas import (
    AllocationOut,
    AsfChargeOut,
    AsfYearStatus,
    CorrectionIn,
    InstalmentOut,
    InstalmentPatch,
    NoticeOut,
    PaymentIn,
    PaymentMetaPatch,
    PaymentOut,
    PaymentResult,
    ScheduleIn,
    ScheduleOut,
    TerminateIn,
)
from app.members.models import Member

router = APIRouter(route_class=TransactionalRoute, tags=["finance"])


@router.get("/members/{member_id}/payments", response_model=list[PaymentOut])
async def list_payments(
    member_id: uuid.UUID,
    session: SessionDep,
    _: User = Depends(require_permission("finance.view")),
    payment_type: str | None = None,
) -> list[PaymentOut]:
    q = select(Payment).where(Payment.member_id == member_id, Payment.deleted_at.is_(None))
    if payment_type:
        q = q.where(Payment.payment_type_code == payment_type)
    rows = (await session.execute(q.order_by(Payment.payment_date.desc(), Payment.created_at.desc()))).scalars()
    return [PaymentOut.model_validate(p) for p in rows]


@router.post("/members/{member_id}/payments", response_model=PaymentResult, status_code=201)
async def record_payment(
    member_id: uuid.UUID,
    body: PaymentIn,
    session: SessionDep,
    user: User = Depends(require_permission("payment.create")),
) -> PaymentResult:
    p, allocs, credit = await service.record_payment(session, member_id, body, user)
    member = await session.get(Member, member_id)
    return PaymentResult(
        payment=PaymentOut.model_validate(p),
        allocations=[AllocationOut.model_validate(a) for a in allocs],
        credit_carried_forward=credit,
        member_status=member.status if member else "",
    )


@router.get("/payments/{payment_id}", response_model=PaymentOut)
async def get_payment(
    payment_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> PaymentOut:
    return PaymentOut.model_validate(await get_or_404(session, Payment, payment_id, label="Payment"))


@router.get("/payments/{payment_id}/allocations", response_model=list[AllocationOut])
async def get_allocations(
    payment_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> list[AllocationOut]:
    rows = await session.execute(select(PaymentAllocation).where(PaymentAllocation.payment_id == payment_id))
    return [AllocationOut.model_validate(a) for a in rows.scalars()]


@router.post("/payments/{payment_id}/corrections", response_model=PaymentOut, status_code=201)
async def correct(
    payment_id: uuid.UUID,
    body: CorrectionIn,
    session: SessionDep,
    user: User = Depends(require_permission("payment.correct")),
) -> PaymentOut:
    return PaymentOut.model_validate(await service.correct_payment(session, payment_id, body, user))


@router.patch("/payments/{payment_id}", response_model=PaymentOut)
async def edit_meta(
    payment_id: uuid.UUID,
    body: PaymentMetaPatch,
    session: SessionDep,
    user: User = Depends(require_permission("payment.correct")),
) -> PaymentOut:
    return PaymentOut.model_validate(await service.edit_payment_metadata(session, payment_id, body, user))


@router.get("/members/{member_id}/schedule", response_model=ScheduleOut | None)
async def get_schedule(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> ScheduleOut | None:
    s = (
        await session.execute(
            select(PaymentSchedule).where(PaymentSchedule.member_id == member_id, PaymentSchedule.is_active.is_(True))
        )
    ).scalar_one_or_none()
    return ScheduleOut.model_validate(s) if s else None


@router.post("/members/{member_id}/schedule", response_model=ScheduleOut, status_code=201)
async def generate_schedule(
    member_id: uuid.UUID,
    body: ScheduleIn,
    session: SessionDep,
    user: User = Depends(require_permission("schedule.manage")),
) -> ScheduleOut:
    return ScheduleOut.model_validate(await service.generate_schedule(session, member_id, body, user))


@router.patch("/instalments/{instalment_id}")
async def edit_instalment(
    instalment_id: uuid.UUID,
    body: InstalmentPatch,
    session: SessionDep,
    user: User = Depends(require_permission("schedule.manage")),
) -> dict[str, Any]:
    inst, warning = await service.edit_instalment(session, instalment_id, body, user)
    return {"instalment": InstalmentOut.model_validate(inst), "warning": warning}


@router.get("/members/{member_id}/asf", response_model=list[AsfYearStatus])
async def asf_status(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> list[AsfYearStatus]:
    member = await get_or_404(session, Member, member_id, label="Member")
    return [
        AsfYearStatus(
            membership_year=r["membership_year"],
            status=r["status"],
            charge=AsfChargeOut.model_validate(r["charge"]) if r["charge"] else None,
            receipt_numbers=r["receipt_numbers"],
        )
        for r in await service.asf_status(session, member)
    ]


@router.get("/members/{member_id}/finance-summary")
async def finance_summary(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> dict[str, Any]:
    member = await get_or_404(session, Member, member_id, label="Member")
    t = await service.totals(session, member_id)
    paid_down = (
        (
            await session.execute(
                select(Payment).where(
                    Payment.member_id == member_id,
                    Payment.payment_type_code == "DOWN_PAYMENT",
                    Payment.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        "purchase_price": str(member.purchase_price),
        "admin_fees": str(member.admin_fees),
        "total_price": str(member.total_price),
        "down_payment": str(member.down_payment_amount),
        "down_payment_received": str(sum((p.total_amount for p in paid_down), ZERO)),
        "balance": str(member.balance),
        "balance_display": "NIL" if member.balance == 0 else str(member.balance),
        "currency": member.currency,
        "credit_balance": str(member.credit_balance),
        "totals": _str(t),
    }


def _str(o: Any) -> Any:
    if isinstance(o, dict):
        return {k: _str(v) for k, v in o.items()}
    return str(o)


@router.get("/finance/totals")
async def global_totals(session: SessionDep, _: User = Depends(require_permission("finance.view"))) -> dict[str, Any]:
    out: dict[str, Any] = _str(await service.totals(session))
    return out


@router.get("/finance/dashboard")
async def dashboard(
    session: SessionDep,
    _: User = Depends(require_permission("finance.view")),
    company_id: uuid.UUID | None = None,
    relationship_manager_id: uuid.UUID | None = None,
    team_manager_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    return await service.dashboard(session, company_id, relationship_manager_id, team_manager_id)


@router.post("/members/{member_id}/default-notices", response_model=NoticeOut, status_code=201)
async def issue_notice(
    member_id: uuid.UUID, session: SessionDep, user: User = Depends(require_permission("finance.default_notice"))
) -> NoticeOut:
    return NoticeOut.model_validate(await service.issue_default_notice(session, member_id, user))


@router.get("/members/{member_id}/default-notices", response_model=list[NoticeOut])
async def list_notices(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("finance.view"))
) -> list[NoticeOut]:
    rows = (
        await session.execute(
            select(DefaultNotice).where(DefaultNotice.member_id == member_id).order_by(DefaultNotice.issued_on.desc())
        )
    ).scalars()
    return [NoticeOut.model_validate(n) for n in rows]


@router.post("/members/{member_id}/terminate")
async def terminate(
    member_id: uuid.UUID,
    body: TerminateIn,
    session: SessionDep,
    user: User = Depends(require_permission("member.terminate")),
) -> dict[str, str]:
    m = await service.terminate(session, member_id, body.reason, user)
    return {"status": m.status}


__all__ = ["Query", "router"]
