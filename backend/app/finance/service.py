"""Finance service. All money is Decimal; every multi-step operation runs in the request transaction."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import AsfRate as AsfRateRow
from app.admin.models import Company, PaymentMethod, PaymentType, TaxRate
from app.admin.service import effective_rate
from app.audit import service as audit
from app.auth.models import User
from app.core.errors import Conflict, NotFound, RuleViolation
from app.core.money import ZERO, money
from app.core.repository import get_or_404
from app.core.sequences import receipt_number
from app.core.settings_store import get_setting
from app.core.timeutil import today_ist
from app.correspondence import letters
from app.finance import domain
from app.finance.models import (
    AsfCharge,
    DefaultNotice,
    Payment,
    PaymentAllocation,
    PaymentSchedule,
    ReservationAsfLink,
    ScheduleInstalment,
)
from app.finance.schemas import CorrectionIn, InstalmentPatch, PaymentIn, PaymentMetaPatch, ScheduleIn
from app.members.models import Member
from app.members.status import set_status

EMI_TYPES = {"MEMBERSHIP_EMI"}


async def _payment_type(session: AsyncSession, code: str) -> PaymentType:
    pt = (await session.execute(select(PaymentType).where(PaymentType.code == code))).scalar_one_or_none()
    if pt is None or not pt.is_active:
        raise RuleViolation(f"Payment type {code} is not available", code="PaymentType")
    return pt


async def _method(session: AsyncSession, method_id: uuid.UUID) -> PaymentMethod:
    pm = await session.get(PaymentMethod, method_id)
    if pm is None or not pm.is_active:
        raise RuleViolation(
            "Payment method is not available (Cash is disabled per the agreement)", code="PaymentMethod"
        )
    return pm


async def gst_rate_for(session: AsyncSession, tax_code: str, on: date) -> Decimal:
    row = await effective_rate(session, TaxRate, on, code=tax_code)
    if row is None:
        raise RuleViolation(f"No tax rate {tax_code} effective on {on}", code="NoTaxRate")
    return Decimal(row.rate_percent)


def _member_name(m: Member) -> str:
    return m.applicants[0].full_name if m.applicants else ""


async def _receipt_doc(
    session: AsyncSession, member: Member, p: Payment, method: PaymentMethod, user: User | None
) -> None:
    company = await session.get(Company, member.company_id)
    doc = await letters.generate(
        session,
        code="RECEIPT",
        doc_type_code="PAYMENT_RECEIPT",
        ctx={"company": company, "m": member, "p": p, "method": method.name, "name": _member_name(member)},
        member_id=member.id,
        file_name=f"receipt-{p.receipt_number}.pdf",
        user=user,
        links=[("PAYMENT", p.id)] + ([("RESERVATION", p.reservation_id)] if p.reservation_id else []),
    )
    p.receipt_document_id = doc.id


async def record_payment(
    session: AsyncSession, member_id: uuid.UUID, data: PaymentIn, user: User, *, generate_receipt: bool = True
) -> tuple[Payment, list[PaymentAllocation], Decimal]:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    if member.status == "TERMINATED":
        raise RuleViolation("Membership is terminated; payments are not accepted", code="MemberTerminated")
    pt = await _payment_type(session, data.payment_type_code)
    pm = await _method(session, data.payment_method_id)
    if pm.requires_reference and not (data.transaction_ref or data.cheque_number):
        raise RuleViolation(
            f"{pm.name} payments need a transaction reference or cheque number", code="ReferenceRequired"
        )
    if pm.requires_bank and not data.bank_name:
        raise RuleViolation("Bank name is required for this method", code="BankRequired")
    if data.card_last4 and not pm.allows_card_last4:
        raise RuleViolation("Card last 4 digits only apply to card payments", code="CardLast4")
    if pt.requires_reservation and data.reservation_id is None:
        raise RuleViolation(f"{pt.code} must be linked to a reservation", code="ReservationRequired")
    if data.currency != member.currency and pt.code in EMI_TYPES | {"DOWN_PAYMENT"}:
        raise RuleViolation("Membership payments must be in the membership currency", code="Currency")

    asf: AsfCharge | None = None
    gst_rate = ZERO
    if pt.code == "ASF":
        if data.asf_charge_id is None:
            raise RuleViolation("Select the ASF charge (membership year) being paid", code="AsfChargeRequired")
        asf = (
            await session.execute(
                select(AsfCharge)
                .where(AsfCharge.id == data.asf_charge_id, AsfCharge.member_id == member.id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if asf is None:
            raise NotFound("ASF charge not found for this member")
        if asf.status == "PAID":
            raise Conflict(f"ASF for {asf.membership_year} is already paid", code="AsfAlreadyPaid")
        if asf.status == "WITHDRAWN":
            raise Conflict(
                f"ASF for {asf.membership_year} was withdrawn (its booking was cancelled); it is raised again by the "
                "next booking that uses that year",
                code="AsfWithdrawn",
            )
        if asf.amount_paid != ZERO or money(data.base_amount) != asf.base_amount:
            # D-14: an ASF charge is settled by one payment of its full base amount (+GST)
            raise RuleViolation(
                f"ASF must be paid in full: base {asf.base_amount} + GST {asf.gst_amount}",
                code="AsfFullPaymentRequired",
            )
        gst_rate = asf.gst_rate  # GST at the rate fixed when the charge was raised
    elif pt.gst_applicable:
        gst_rate = await gst_rate_for(session, pt.tax_code or "GST", data.payment_date)
    rate, gst, total = domain.gst_for(pt.gst_applicable or pt.code == "ASF", data.base_amount, gst_rate)

    company = await session.get(Company, member.company_id)
    assert company is not None
    p = Payment(
        member_id=member.id,
        company_id=member.company_id,
        payment_type_code=pt.code,
        base_amount=money(data.base_amount),
        gst_rate=rate,
        gst_amount=gst,
        total_amount=total,
        currency=data.currency,
        due_date=data.due_date,
        payment_date=data.payment_date,
        payment_method_id=pm.id,
        transaction_ref=data.transaction_ref,
        cheque_number=data.cheque_number,
        bank_name=data.bank_name,
        card_last4=data.card_last4,
        remarks=data.remarks,
        reservation_id=data.reservation_id,
        asf_charge_id=asf.id if asf else None,
        asf_year=asf.membership_year if asf else None,
        receipt_number=await receipt_number(session, company.code, company.receipt_prefix, data.payment_date.year),
        created_by=user.id,
        updated_by=user.id,
    )
    session.add(p)
    await session.flush()

    allocations: list[PaymentAllocation] = []
    credit = ZERO
    if pt.code in EMI_TYPES:
        allocations, credit = await _allocate(session, member, p, data.allocate_to)
    if asf is not None:
        asf.amount_paid = money(asf.amount_paid + total)
        asf.status = "PAID" if asf.amount_paid >= asf.total_amount else "RAISED"
    if generate_receipt:
        await _receipt_doc(session, member, p, pm, user)
    audit.record(
        session,
        "PAYMENT",
        f"Payment {p.receipt_number} {pt.code} {p.total_amount} {p.currency} recorded",
        entity_type="payments",
        entity_id=p.id,
        entity_ref=p.receipt_number,
        member_id=member.id,
    )
    await check_default_cure(session, member, user)
    await session.flush()
    return p, allocations, credit


async def _allocate(
    session: AsyncSession, member: Member, p: Payment, targets: Sequence[uuid.UUID] | None
) -> tuple[list[PaymentAllocation], Decimal]:
    rows = list(
        (
            await session.execute(
                select(ScheduleInstalment)
                .join(PaymentSchedule)
                .where(
                    ScheduleInstalment.member_id == member.id,
                    PaymentSchedule.is_active.is_(True),
                    ScheduleInstalment.amount_paid < ScheduleInstalment.amount_due,
                )
                .with_for_update(of=ScheduleInstalment)
            )
        ).scalars()
    )
    if not rows:
        raise RuleViolation("No open EMI instalments; generate the EMI schedule first", code="NoSchedule")
    opens = [domain.OpenInstalment(r.id, r.number, r.due_date, r.amount_due, r.amount_paid) for r in rows]
    result = domain.allocate_payment(p.base_amount, opens, targets)
    by_id = {r.id: r for r in rows}
    today = today_ist()
    out = []
    for a in result.allocations:
        inst = by_id[a.instalment_id]  # type: ignore[index]
        inst.amount_paid = money(inst.amount_paid + a.amount)
        inst.status = domain.instalment_status(inst.amount_due, inst.amount_paid, inst.due_date, today).value
        pa = PaymentAllocation(payment_id=p.id, instalment_id=inst.id, amount=a.amount)
        session.add(pa)
        out.append(pa)
    if result.credit > ZERO:
        member.credit_balance = money(member.credit_balance + result.credit)
        audit.record(
            session,
            "CREDIT",
            f"Overpayment {result.credit} carried forward as credit",
            entity_type="members",
            entity_id=member.id,
            member_id=member.id,
        )
    return out, result.credit


async def correct_payment(session: AsyncSession, payment_id: uuid.UUID, data: CorrectionIn, user: User) -> Payment:
    orig = await get_or_404(session, Payment, payment_id, for_update=True, label="Payment")
    if orig.entry_kind != "NORMAL":
        raise RuleViolation("Only original payments can be corrected", code="CorrectCorrection")
    already = (
        await session.execute(
            select(func.count()).where(Payment.corrects_payment_id == orig.id, Payment.entry_kind == "REVERSAL")
        )
    ).scalar_one()
    if already:
        raise Conflict("Payment has already been reversed", code="AlreadyReversed")
    member = await get_or_404(session, Member, orig.member_id, for_update=True, label="Member")
    company = await session.get(Company, orig.company_id)
    assert company is not None
    if data.kind == "REVERSAL":
        base, gst = -orig.base_amount, -orig.gst_amount
    else:
        if data.amount is None or data.amount == 0:
            raise RuleViolation("Adjustment amount is required (signed)", code="AdjustmentAmount")
        base = money(data.amount)
        gst = money(base * orig.gst_rate / Decimal(100))
    corr = Payment(
        member_id=orig.member_id,
        company_id=orig.company_id,
        payment_type_code=orig.payment_type_code,
        entry_kind=data.kind,
        corrects_payment_id=orig.id,
        base_amount=base,
        gst_rate=orig.gst_rate,
        gst_amount=gst,
        total_amount=money(base + gst),
        currency=orig.currency,
        payment_date=today_ist(),
        payment_method_id=orig.payment_method_id,
        receipt_number=await receipt_number(session, company.code, company.receipt_prefix, today_ist().year),
        reservation_id=orig.reservation_id,
        asf_charge_id=orig.asf_charge_id,
        asf_year=orig.asf_year,
        correction_reason=data.reason,
        remarks=f"{data.kind} of {orig.receipt_number}: {data.reason}",
        created_by=user.id,
        updated_by=user.id,
    )
    session.add(corr)
    await session.flush()
    delta = money(base + gst)
    if orig.payment_type_code in EMI_TYPES:
        await _unwind_allocations(session, orig, -base, corr)
    if orig.asf_charge_id:
        asf = await session.get(AsfCharge, orig.asf_charge_id, with_for_update=True)
        if asf:
            asf.amount_paid = money(asf.amount_paid + delta)
            asf.status = "PAID" if asf.amount_paid >= asf.total_amount else "RAISED"
    audit.record(
        session,
        "PAYMENT_CORRECTION",
        f"{data.kind} {corr.receipt_number} for {orig.receipt_number}: {data.reason}",
        entity_type="payments",
        entity_id=corr.id,
        entity_ref=corr.receipt_number,
        member_id=member.id,
        changes={"amount": [str(orig.total_amount), str(delta)]},
    )
    return corr


async def _unwind_allocations(session: AsyncSession, orig: Payment, amount: Decimal, corr: Payment) -> None:
    """Positive `amount` removes money from instalments (latest allocated first); negative adds (adjustment up)."""
    if amount < ZERO:
        member = await session.get(Member, orig.member_id)
        assert member is not None
        corr_base = -amount
        rows = list(
            (
                await session.execute(
                    select(ScheduleInstalment)
                    .join(PaymentSchedule)
                    .where(
                        ScheduleInstalment.member_id == orig.member_id,
                        PaymentSchedule.is_active.is_(True),
                        ScheduleInstalment.amount_paid < ScheduleInstalment.amount_due,
                    )
                    .order_by(ScheduleInstalment.due_date)
                    .with_for_update(of=ScheduleInstalment)
                )
            ).scalars()
        )
        opens = [domain.OpenInstalment(r.id, r.number, r.due_date, r.amount_due, r.amount_paid) for r in rows]
        res = domain.allocate_payment(corr_base, opens) if opens else domain.AllocationResult([], corr_base)
        by_id = {r.id: r for r in rows}
        for a in res.allocations:
            inst = by_id[a.instalment_id]  # type: ignore[index]
            inst.amount_paid = money(inst.amount_paid + a.amount)
            inst.status = domain.instalment_status(inst.amount_due, inst.amount_paid, inst.due_date, today_ist()).value
            session.add(PaymentAllocation(payment_id=corr.id, instalment_id=inst.id, amount=a.amount))
        if res.credit > ZERO:
            member.credit_balance = money(member.credit_balance + res.credit)
        return
    allocs = list(
        (
            await session.execute(
                select(PaymentAllocation).where(PaymentAllocation.payment_id == orig.id).order_by(PaymentAllocation.id)
            )
        ).scalars()
    )
    remaining = amount
    for alloc in reversed(allocs):
        if remaining <= ZERO:
            break
        take = min(alloc.amount, remaining)
        inst_row = await session.get(ScheduleInstalment, alloc.instalment_id, with_for_update=True)
        assert inst_row is not None
        inst = inst_row
        inst.amount_paid = money(inst.amount_paid - take)
        inst.status = domain.instalment_status(inst.amount_due, inst.amount_paid, inst.due_date, today_ist()).value
        session.add(PaymentAllocation(payment_id=corr.id, instalment_id=inst.id, amount=-take))
        remaining = money(remaining - take)
    if remaining > ZERO:  # part of the original became credit; take it back from credit
        member = await session.get(Member, orig.member_id)
        assert member is not None
        member.credit_balance = money(member.credit_balance - remaining)


async def edit_payment_metadata(
    session: AsyncSession, payment_id: uuid.UUID, data: PaymentMetaPatch, user: User
) -> Payment:
    p = await get_or_404(session, Payment, payment_id, label="Payment")
    if p.version != data.version:
        raise Conflict("Payment was modified by someone else", code="VersionConflict")
    session.info["reason"] = data.reason
    for k, v in data.model_dump(exclude_unset=True, exclude={"reason", "version"}).items():
        setattr(p, k, v)
    p.correction_reason = data.reason
    p.updated_by = user.id
    await session.flush()
    return p


# ---------------------------------------------------------------- schedules
async def generate_schedule(
    session: AsyncSession, member_id: uuid.UUID, data: ScheduleIn, user: User
) -> PaymentSchedule:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    existing = (
        await session.execute(
            select(PaymentSchedule).where(PaymentSchedule.member_id == member.id, PaymentSchedule.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if existing is not None:
        paid = any(i.amount_paid > 0 for i in existing.instalments)
        if paid:
            raise Conflict("A schedule with payments already exists; edit instalments instead", code="ScheduleExists")
        existing.is_active = False
        await session.flush()
    balance = data.balance if data.balance is not None else member.balance
    emi = data.emi_amount or member.emi_amount
    count = data.emi_count or member.emi_count
    sy = data.start_year or member.emi_start_year
    sm = data.start_month or member.emi_start_month
    if not (emi and count and sy and sm):
        raise RuleViolation("EMI amount, number of EMIs and starting month/year are required", code="EmiFields")
    due_day = data.due_day or int(await get_setting(session, "finance.emi_due_day"))
    if member.instalment_start_date and data.due_day is None:
        due_day = min(member.instalment_start_date.day, 28)
    plan = domain.generate_emi_schedule(balance, emi, count, sy, sm, due_day)
    sched = PaymentSchedule(
        member_id=member.id,
        balance=balance,
        emi_amount=emi,
        emi_count=count,
        start_year=sy,
        start_month=sm,
        generation_warning=plan.warning,
        created_by=user.id,
    )
    session.add(sched)
    await session.flush()
    today = today_ist()
    for pi in plan.instalments:
        session.add(
            ScheduleInstalment(
                schedule_id=sched.id,
                member_id=member.id,
                number=pi.number,
                due_date=pi.due_date,
                amount_due=pi.amount_due,
                status=domain.instalment_status(pi.amount_due, ZERO, pi.due_date, today).value,
            )
        )
    await session.flush()
    await session.refresh(sched, ["instalments"])
    audit.record(
        session,
        "SCHEDULE_GENERATED",
        f"EMI schedule {count} x {emi} generated" + (f"; {plan.warning}" if plan.warning else ""),
        entity_type="payment_schedules",
        entity_id=sched.id,
        member_id=member.id,
    )
    return sched


async def edit_instalment(
    session: AsyncSession, inst_id: uuid.UUID, data: InstalmentPatch, user: User
) -> tuple[ScheduleInstalment, str | None]:
    inst = await session.get(ScheduleInstalment, inst_id, with_for_update=True)
    if inst is None:
        raise NotFound("Instalment not found")
    if inst.version != data.version:
        raise Conflict("Instalment was modified by someone else", code="VersionConflict")
    session.info["reason"] = data.reason
    if data.amount_due is not None:
        if data.amount_due < inst.amount_paid:
            raise RuleViolation("Amount due cannot be below the amount already paid", code="AmountBelowPaid")
        inst.amount_due = money(data.amount_due)
    if data.due_date is not None:
        inst.due_date = data.due_date
    inst.status = domain.instalment_status(inst.amount_due, inst.amount_paid, inst.due_date, today_ist()).value
    inst.updated_by = user.id
    await session.flush()
    sched = await session.get(PaymentSchedule, inst.schedule_id)
    assert sched is not None
    total = sum(
        (
            i.amount_due
            for i in (
                await session.execute(select(ScheduleInstalment).where(ScheduleInstalment.schedule_id == sched.id))
            ).scalars()
        ),
        ZERO,
    )
    warning = None if total == sched.balance else f"Schedule now totals {total}, balance is {sched.balance}"
    return inst, warning


async def mark_overdue(session: AsyncSession, today: date | None = None) -> int:
    """Idempotent job: PENDING/PART_PAID instalments past due become OVERDUE."""
    today = today or today_ist()
    rows = (
        (
            await session.execute(
                select(ScheduleInstalment)
                .where(ScheduleInstalment.due_date < today, ScheduleInstalment.status.in_(["PENDING", "PART_PAID"]))
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for r in rows:
        r.status = "OVERDUE"
    return len(rows)


# ---------------------------------------------------------------- ASF
async def asf_rate_on(session: AsyncSession, member: Member, on: date) -> tuple[domain.AsfRate, AsfRateRow]:
    row = await effective_rate(session, AsfRateRow, on, unit_type_id=member.unit_type_id, company_id=member.company_id)
    if row is None:
        row = await effective_rate(session, AsfRateRow, on, unit_type_id=member.unit_type_id, company_id=None)
    if row is None:
        raise RuleViolation("No ASF rate is configured for this unit type on the booking date", code="NoAsfRate")
    gst = await gst_rate_for(session, row.tax_code, on)
    return domain.AsfRate(row.amount, gst, row.currency), row


async def raise_asf_for_booking(
    session: AsyncSession,
    member: Member,
    reservation_id: uuid.UUID,
    years_used: list[tuple[int, str]],
    booking_date: date,
) -> list[AsfCharge]:
    """Raise ASF (once per membership year) and link every needed charge to the reservation."""
    existing = list(
        (
            await session.execute(
                select(AsfCharge)
                .where(AsfCharge.member_id == member.id, AsfCharge.membership_year.in_([y for y, _ in years_used]))
                .with_for_update()
            )
        ).scalars()
    )
    state = {c.membership_year: c for c in existing}
    rate_cache: dict[date, tuple[domain.AsfRate, AsfRateRow]] = {}

    async def _rate(d: date) -> tuple[domain.AsfRate, AsfRateRow]:
        if d not in rate_cache:
            rate_cache[d] = await asf_rate_on(session, member, d)
        return rate_cache[d]

    need_rate = any(y not in state or state[y].status == "WITHDRAWN" for y, _ in years_used)
    rate, rate_row = await _rate(booking_date) if need_rate else (None, None)
    charge_saved = bool(await get_setting(session, "asf.charge_unraised_saved_source"))
    decision = domain.decide_asf(
        booking_date=booking_date,
        years_used=years_used,
        existing=[domain.ExistingAsf(c.membership_year, domain.AsfChargeState(c.status)) for c in existing],
        rate_on=lambda _d: rate,  # type: ignore[arg-type,return-value]
        charge_unraised_saved_source=charge_saved,
    )
    created = []
    again: set[uuid.UUID] = set()
    for r in decision.to_raise:
        fields = {
            "raised_on": booking_date,
            "raised_by_reservation_id": reservation_id,
            "reason": r.reason,
            "asf_rate_id": rate_row.id if rate_row else None,
            "base_amount": r.base,
            "gst_rate": r.gst_rate,
            "gst_amount": r.gst,
            "total_amount": r.total,
            "currency": r.currency,
        }
        old = state.get(r.membership_year)
        if old is not None:  # WITHDRAWN earlier: raise the same row again at today's rate (unique per member/year)
            for k, v in fields.items():
                setattr(old, k, v)
            old.status, old.amount_paid, old.withdrawn_on, old.withdrawn_reason = "RAISED", ZERO, None, None
            c = old
            again.add(c.id)
        else:
            c = AsfCharge(member_id=member.id, membership_year=r.membership_year, **fields)
            session.add(c)
        created.append(c)
        state[r.membership_year] = c
    await session.flush()
    for c in created:
        audit.record(
            session,
            "ASF_RAISED",
            f"ASF for membership year {c.membership_year} raised{' again' if c.id in again else ''}: "
            f"{c.total_amount} {c.currency} incl. GST ({c.reason})",
            entity_type="asf_charges",
            entity_id=c.id,
            member_id=member.id,
        )
    for y in {y for y, _ in years_used}:
        if y in state:
            exists = (
                await session.execute(
                    select(ReservationAsfLink).where(
                        ReservationAsfLink.reservation_id == reservation_id,
                        ReservationAsfLink.asf_charge_id == state[y].id,
                    )
                )
            ).scalar_one_or_none()
            if exists is None:
                session.add(ReservationAsfLink(reservation_id=reservation_id, asf_charge_id=state[y].id))
    await session.flush()
    return created


async def preview_asf(
    session: AsyncSession, member: Member, years_used: list[tuple[int, str]], booking_date: date
) -> list[dict[str, Any]]:
    existing = list((await session.execute(select(AsfCharge).where(AsfCharge.member_id == member.id))).scalars())
    rate = None
    live = {c.membership_year for c in existing if c.status != "WITHDRAWN"}
    if any(y not in live for y, _ in years_used):
        rate, _ = await asf_rate_on(session, member, booking_date)
    decision = domain.decide_asf(
        booking_date=booking_date,
        years_used=years_used,
        existing=[domain.ExistingAsf(c.membership_year, domain.AsfChargeState(c.status)) for c in existing],
        rate_on=lambda _d: rate,  # type: ignore[arg-type,return-value]
        charge_unraised_saved_source=bool(await get_setting(session, "asf.charge_unraised_saved_source")),
    )
    out = [
        {
            "membership_year": r.membership_year,
            "base": str(r.base),
            "gst_rate": str(r.gst_rate),
            "gst": str(r.gst),
            "total": str(r.total),
            "currency": r.currency,
            "reason": r.reason,
            "new": True,
        }
        for r in decision.to_raise
    ]
    by_year = {c.membership_year: c for c in existing}
    for y in decision.link_existing:
        c = by_year[y]
        out.append(
            {
                "membership_year": y,
                "total": str(c.total_amount),
                "status": c.status,
                "new": False,
                "currency": c.currency,
            }
        )
    return out


async def withdraw_unpaid_asf(
    session: AsyncSession,
    reservation_id: uuid.UUID,
    why: str,
    user: User | None,
    on: date | None = None,
    *,
    dry_run: bool = False,
) -> list[int]:
    """D-33: when a reservation is cancelled or declined, withdraw each ASF charge it raised or used that is still
    unpaid, unless another live reservation uses that membership year. Paid ASF is never refunded or changed.
    Setting `asf.withdraw_unpaid_on_cancel` (default on). Returns the membership years withdrawn."""
    if not bool(await get_setting(session, "asf.withdraw_unpaid_on_cancel")):
        return []
    from app.reservations.models import Reservation  # import here: reservations imports finance

    q = (
        select(AsfCharge)
        .join(ReservationAsfLink, ReservationAsfLink.asf_charge_id == AsfCharge.id)
        .where(ReservationAsfLink.reservation_id == reservation_id)
    )
    charges = list((await session.execute(q if dry_run else q.with_for_update(of=AsfCharge))).scalars())
    withdrawn: list[int] = []
    for c in charges:
        if c.status != "RAISED" or c.amount_paid != ZERO:
            continue  # paid (or part paid, which D-14 forbids anyway): never touched
        others = (
            await session.execute(
                select(func.count())
                .select_from(ReservationAsfLink)
                .join(Reservation, Reservation.id == ReservationAsfLink.reservation_id)
                .where(
                    ReservationAsfLink.asf_charge_id == c.id,
                    ReservationAsfLink.reservation_id != reservation_id,
                    Reservation.status.not_in(["CANCELLED", "DECLINED"]),
                    Reservation.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        if others:
            continue
        withdrawn.append(c.membership_year)
        if dry_run:
            continue
        c.status, c.withdrawn_on, c.withdrawn_reason = "WITHDRAWN", on or today_ist(), why[:300]
        c.updated_by = user.id if user else None
        audit.record(
            session,
            "ASF_WITHDRAWN",
            f"Unpaid ASF for membership year {c.membership_year} ({c.total_amount} {c.currency} incl. GST) "
            f"withdrawn: {why}",
            entity_type="asf_charges",
            entity_id=c.id,
            member_id=c.member_id,
        )
    return sorted(withdrawn)


async def unpaid_asf_years(session: AsyncSession, reservation_id: uuid.UUID) -> list[int]:
    rows = (
        await session.execute(
            select(AsfCharge.membership_year)
            .join(ReservationAsfLink, ReservationAsfLink.asf_charge_id == AsfCharge.id)
            .where(ReservationAsfLink.reservation_id == reservation_id, AsfCharge.status == "RAISED")
        )
    ).scalars()
    return sorted(set(rows))


async def asf_status(session: AsyncSession, member: Member) -> list[dict[str, Any]]:
    charges = {
        c.membership_year: c
        for c in (await session.execute(select(AsfCharge).where(AsfCharge.member_id == member.id))).scalars()
    }
    receipts: dict[uuid.UUID, list[str]] = {}
    for p in (
        await session.execute(select(Payment).where(Payment.member_id == member.id, Payment.asf_charge_id.is_not(None)))
    ).scalars():
        receipts.setdefault(p.asf_charge_id, []).append(p.receipt_number)  # type: ignore[arg-type]
    out = []
    for y in range(member.first_year_of_use, member.last_year_of_use + 1):
        c = charges.get(y)
        out.append(
            {
                "membership_year": y,
                "status": c.status if c else "NOT_YET_DUE",
                "charge": c,
                "receipt_numbers": receipts.get(c.id, []) if c else [],
            }
        )
    return out


# ---------------------------------------------------------------- default handling
async def overdue_amount(session: AsyncSession, member_id: uuid.UUID, today: date | None = None) -> Decimal:
    today = today or today_ist()
    v = (
        await session.execute(
            select(func.coalesce(func.sum(ScheduleInstalment.amount_due - ScheduleInstalment.amount_paid), 0))
            .join(PaymentSchedule)
            .where(
                ScheduleInstalment.member_id == member_id,
                PaymentSchedule.is_active.is_(True),
                ScheduleInstalment.due_date < today,
                ScheduleInstalment.amount_paid < ScheduleInstalment.amount_due,
            )
        )
    ).scalar_one()
    return money(v)


async def issue_default_notice(session: AsyncSession, member_id: uuid.UUID, user: User) -> DefaultNotice:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    if member.status != "ACTIVE":
        raise RuleViolation("Default notices can only be issued to ACTIVE members", code="NotActive")
    amount = await overdue_amount(session, member.id)
    if amount <= ZERO:
        raise RuleViolation("Member has no overdue EMI", code="NothingOverdue")
    days = int(await get_setting(session, "finance.default_notice_days"))
    issued = today_ist()
    notice = DefaultNotice(
        member_id=member.id,
        issued_on=issued,
        deadline=domain.default_notice_deadline(issued, days),
        amount_overdue=amount,
        currency=member.currency,
        created_by=user.id,
    )
    session.add(notice)
    await session.flush()
    company = await session.get(Company, member.company_id)
    doc = await letters.generate(
        session,
        code="DEFAULT_NOTICE",
        doc_type_code="DEFAULT_NOTICE",
        ctx={"company": company, "m": member, "notice": notice, "days": days, "name": _member_name(member)},
        member_id=member.id,
        file_name=f"default-notice-{issued.isoformat()}.pdf",
        user=user,
    )
    notice.document_id = doc.id
    set_status(session, member, "DEFAULT_NOTICE", user, f"Default notice issued; deadline {notice.deadline}")
    audit.record(
        session,
        "DEFAULT_NOTICE",
        f"Default notice issued for {amount} {member.currency}, deadline {notice.deadline}",
        entity_type="default_notices",
        entity_id=notice.id,
        member_id=member.id,
    )
    return notice


async def check_default_cure(session: AsyncSession, member: Member, user: User | None) -> None:
    if member.status != "DEFAULT_NOTICE":
        return
    notice = (
        await session.execute(
            select(DefaultNotice).where(DefaultNotice.member_id == member.id, DefaultNotice.status == "OPEN")
        )
    ).scalar_one_or_none()
    if notice is None:
        return
    await session.flush()
    state = domain.default_notice_state(
        notice.issued_on,
        (notice.deadline - notice.issued_on).days,
        await overdue_amount(session, member.id),
        today_ist(),
    )
    if state == "CURED":
        notice.status = "CURED"
        set_status(session, member, "ACTIVE", user, "Overdue amount paid within the default-notice window")


async def terminate(session: AsyncSession, member_id: uuid.UUID, reason: str, user: User) -> Member:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    notice = (
        await session.execute(
            select(DefaultNotice).where(DefaultNotice.member_id == member.id, DefaultNotice.status == "OPEN")
        )
    ).scalar_one_or_none()
    if member.status != "DEFAULT_NOTICE" or notice is None:
        raise RuleViolation("Termination requires an open default notice", code="NoOpenNotice")
    state = domain.default_notice_state(
        notice.issued_on,
        (notice.deadline - notice.issued_on).days,
        await overdue_amount(session, member.id),
        today_ist(),
    )
    if state != "EXPIRED":
        raise RuleViolation(
            f"Cannot terminate before the deadline {notice.deadline} (state {state})", code="NoticeNotExpired"
        )
    notice.status = "TERMINATED"
    for p in (await session.execute(select(Payment).where(Payment.member_id == member.id))).scalars():
        p.is_forfeited = True
    set_status(session, member, "TERMINATED", user, reason)
    audit.record(
        session,
        "TERMINATION",
        f"Membership {member.membership_number} terminated: {reason}. Payments "
        "forfeited; outstanding balance remains a liability.",
        entity_type="members",
        entity_id=member.id,
        entity_ref=member.membership_number,
        member_id=member.id,
    )
    return member


# ---------------------------------------------------------------- totals / dashboard
async def totals(session: AsyncSession, member_id: uuid.UUID | None = None) -> dict[str, Any]:
    q = select(Payment.currency, Payment.payment_type_code, Payment.base_amount, Payment.gst_amount).where(
        Payment.deleted_at.is_(None)
    )
    if member_id:
        q = q.where(Payment.member_id == member_id)
    collected = domain.totals_by_type_and_currency((await session.execute(q)).all())
    today = today_ist()
    iq = (
        select(Member.currency, func.sum(ScheduleInstalment.amount_due - ScheduleInstalment.amount_paid))
        .join(PaymentSchedule, PaymentSchedule.id == ScheduleInstalment.schedule_id)
        .join(Member, Member.id == ScheduleInstalment.member_id)
        .where(PaymentSchedule.is_active.is_(True))
    )
    if member_id:
        iq = iq.where(ScheduleInstalment.member_id == member_id)
    outstanding_emi = {cur: money(v or 0) for cur, v in (await session.execute(iq.group_by(Member.currency))).all()}
    overdue_emi = {
        cur: money(v or 0)
        for cur, v in (
            await session.execute(iq.where(ScheduleInstalment.due_date < today).group_by(Member.currency))
        ).all()
    }
    aq = select(AsfCharge.currency, func.sum(AsfCharge.total_amount - AsfCharge.amount_paid)).where(
        AsfCharge.status == "RAISED"
    )
    if member_id:
        aq = aq.where(AsfCharge.member_id == member_id)
    asf_out = {cur: money(v or 0) for cur, v in (await session.execute(aq.group_by(AsfCharge.currency))).all()}
    return {
        "collected": collected,
        "outstanding": {"MEMBERSHIP_EMI": outstanding_emi, "ASF": asf_out},
        "overdue": {"MEMBERSHIP_EMI": overdue_emi},
    }


async def dashboard(
    session: AsyncSession, company_id: uuid.UUID | None, rm_id: uuid.UUID | None, tm_id: uuid.UUID | None
) -> dict[str, Any]:
    today = today_ist()

    def scope(q: Any) -> Any:
        if company_id:
            q = q.where(Member.company_id == company_id)
        if rm_id:
            q = q.where(Member.relationship_manager_id == rm_id)
        if tm_id:
            q = q.where(Member.team_manager_id == tm_id)
        return q

    overdue = (
        await session.execute(
            scope(
                select(
                    Member.id,
                    Member.membership_number,
                    ScheduleInstalment.number,
                    ScheduleInstalment.due_date,
                    (ScheduleInstalment.amount_due - ScheduleInstalment.amount_paid).label("due"),
                )
                .join(ScheduleInstalment, ScheduleInstalment.member_id == Member.id)
                .join(PaymentSchedule, PaymentSchedule.id == ScheduleInstalment.schedule_id)
                .where(
                    PaymentSchedule.is_active.is_(True),
                    ScheduleInstalment.due_date < today,
                    ScheduleInstalment.amount_paid < ScheduleInstalment.amount_due,
                )
                .order_by(ScheduleInstalment.due_date)
            ).limit(500)
        )
    ).all()
    from app.reservations.models import Reservation

    waiting_asf = (
        await session.execute(
            scope(
                select(
                    Reservation.id,
                    Reservation.reservation_number,
                    Member.id,
                    Member.membership_number,
                    AsfCharge.membership_year,
                    (AsfCharge.total_amount - AsfCharge.amount_paid).label("due"),
                )
                .join(Member, Member.id == Reservation.member_id)
                .join(ReservationAsfLink, ReservationAsfLink.reservation_id == Reservation.id)
                .join(AsfCharge, AsfCharge.id == ReservationAsfLink.asf_charge_id)
                .where(AsfCharge.status == "RAISED", Reservation.status.in_(["REQUESTED", "APPROVED"]))
            ).limit(500)
        )
    ).all()
    notices = (
        await session.execute(
            scope(
                select(Member.id, Member.membership_number, DefaultNotice.deadline, DefaultNotice.amount_overdue)
                .join(DefaultNotice, DefaultNotice.member_id == Member.id)
                .where(DefaultNotice.status == "OPEN")
            ).order_by(DefaultNotice.deadline)
        )
    ).all()
    return {
        "overdue_emis": [
            {"member_id": r[0], "membership_number": r[1], "instalment": r[2], "due_date": r[3], "amount": str(r[4])}
            for r in overdue
        ],
        "reservations_waiting_asf": [
            {
                "reservation_id": r[0],
                "reservation_number": r[1],
                "member_id": r[2],
                "membership_number": r[3],
                "membership_year": r[4],
                "amount": str(r[5]),
            }
            for r in waiting_asf
        ],
        "default_notices": [
            {
                "member_id": r[0],
                "membership_number": r[1],
                "deadline": r[2],
                "days_remaining": (r[2] - today).days,
                "amount": str(r[3]),
            }
            for r in notices
        ],
    }
