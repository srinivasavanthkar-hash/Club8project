"""Entitlement ledger service.

Concurrency: every operation that reads balances and writes movements first locks the member's
`entitlement_years` rows (SELECT ... FOR UPDATE), so two bookings cannot both consume the same nights.
Idempotency: every ledger row carries a unique idempotency_key; `reservation_deductions` has a partial
unique index allowing exactly one active (HELD/DEDUCTED) deduction per reservation.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import ResortCategory, Season, UnitType
from app.audit import service as audit
from app.auth.models import User
from app.core.errors import RuleViolation
from app.core.money import ZERO, nights
from app.core.settings_store import get_settings_map
from app.entitlement import domain
from app.entitlement.models import EntitlementLedger, EntitlementYear, ReservationDeduction
from app.members.models import Member


async def policy_for(session: AsyncSession, member: Member) -> domain.EntitlementPolicy:
    s = await get_settings_map(
        session, ["entitlement.save_years", "entitlement.borrow_years", "entitlement.consumption_order"]
    )
    return domain.EntitlementPolicy(
        first_year=member.first_year_of_use,
        last_year=member.last_year_of_use,
        save_years=int(s["entitlement.save_years"]),
        borrow_years=int(s["entitlement.borrow_years"]),
        consumption_order=tuple(domain.BucketKind(k) for k in s["entitlement.consumption_order"]),
    )


async def _add(
    session: AsyncSession,
    member_id: uuid.UUID,
    origin_year: int,
    entry_type: domain.EntryType,
    delta: Decimal,
    key: str,
    *,
    use_year: int | None = None,
    reservation_id: uuid.UUID | None = None,
    offer_id: uuid.UUID | None = None,
    note: str | None = None,
    user: User | None = None,
) -> bool:
    """Insert a ledger row; returns False if the idempotency key already exists (no double movement)."""
    if delta == ZERO:
        return False
    res = await session.execute(
        insert(EntitlementLedger)
        .values(
            id=uuid.uuid4(),
            member_id=member_id,
            origin_year=origin_year,
            use_year=use_year,
            entry_type=entry_type.value,
            delta=nights(delta),
            reservation_id=reservation_id,
            joining_offer_id=offer_id,
            idempotency_key=key,
            note=note,
            created_by=user.id if user else None,
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
    )
    return bool(getattr(res, "rowcount", 0))


async def seed_member(session: AsyncSession, member: Member, user: User | None) -> None:
    cat = await session.get(ResortCategory, member.resort_category_id)
    sea = await session.get(Season, member.season_id)
    ut = await session.get(UnitType, member.unit_type_id)
    assert cat and sea and ut
    for y in range(member.first_year_of_use, member.last_year_of_use + 1):
        await session.execute(
            insert(EntitlementYear)
            .values(
                id=uuid.uuid4(),
                member_id=member.id,
                year=y,
                allocated=member.nights_per_year,
                resort_category_code=cat.code,
                season_code=sea.code,
                unit_type_code=ut.code,
            )
            .on_conflict_do_nothing(index_elements=["member_id", "year"])
        )
        await _add(
            session,
            member.id,
            y,
            domain.EntryType.ALLOCATION,
            member.nights_per_year,
            f"alloc:{member.id}:{y}",
            note="Annual allocation",
            user=user,
        )
    for offer in member.joining_offers:
        if offer.nights and offer.nights > 0:
            year = offer.credit_year or member.first_year_of_use
            if not member.first_year_of_use <= year <= member.last_year_of_use:
                raise RuleViolation(
                    f"Joining-offer credit year {year} is outside the membership period", code="OfferYear"
                )
            await _add(
                session,
                member.id,
                year,
                domain.EntryType.BONUS,
                offer.nights,
                f"bonus:{offer.id}",
                offer_id=offer.id,
                note=f"Joining offer: {offer.description}",
                user=user,
            )
    audit.record(
        session,
        "ENTITLEMENT_SEEDED",
        f"Entitlement seeded {member.first_year_of_use}-"
        f"{member.last_year_of_use} at {member.nights_per_year} nights/year",
        entity_type="members",
        entity_id=member.id,
        member_id=member.id,
    )


async def lock_member_buckets(session: AsyncSession, member_id: uuid.UUID) -> None:
    await session.execute(
        select(EntitlementYear.id)
        .where(EntitlementYear.member_id == member_id)
        .order_by(EntitlementYear.year)
        .with_for_update()
    )


async def entries(session: AsyncSession, member_id: uuid.UUID) -> list[domain.LedgerEntry]:
    rows = (
        await session.execute(
            select(EntitlementLedger)
            .where(EntitlementLedger.member_id == member_id)
            .order_by(EntitlementLedger.created_at)
        )
    ).scalars()
    return [
        domain.LedgerEntry(
            r.origin_year,
            domain.EntryType(r.entry_type),
            r.delta,
            r.use_year,
            str(r.reservation_id) if r.reservation_id else None,
        )
        for r in rows
    ]


async def plan(
    session: AsyncSession,
    member: Member,
    required: Decimal,
    use_year: int,
    on: date,
    exclude_reservation: uuid.UUID | None = None,
) -> domain.ConsumptionPlan:
    """Plan against current balances. When re-planning a reschedule, the reservation's own current
    movement is added back first so it can reuse its nights."""
    ents = await entries(session, member.id)
    bal = domain.balances(ents)
    if exclude_reservation:
        current = await active_deduction(session, exclude_reservation)
        if current:
            for y, n in _plan_years(current).items():
                bal[y] = nights(bal.get(y, ZERO) + n)
    return domain.plan_consumption(required, use_year, on, bal, await policy_for(session, member))


async def active_deduction(
    session: AsyncSession, reservation_id: uuid.UUID, *, lock: bool = True
) -> ReservationDeduction | None:
    q = select(ReservationDeduction).where(
        ReservationDeduction.reservation_id == reservation_id,
        ReservationDeduction.state.in_(["HELD", "DEDUCTED"]),
    )
    return (await session.execute(q.with_for_update() if lock else q)).scalar_one_or_none()


def _plan_years(d: ReservationDeduction) -> dict[int, Decimal]:
    return {int(ln["year"]): Decimal(ln["nights"]) for ln in d.plan["lines"]}


def _plan_json(p: domain.ConsumptionPlan) -> dict[str, Any]:
    return {"lines": [{"year": ln.origin_year, "kind": ln.kind.value, "nights": str(ln.nights)} for ln in p.lines]}


async def hold(
    session: AsyncSession,
    member: Member,
    reservation_id: uuid.UUID,
    p: domain.ConsumptionPlan,
    use_year: int,
    user: User,
) -> ReservationDeduction:
    if await active_deduction(session, reservation_id):
        raise RuleViolation("Reservation already has an active entitlement movement", code="DuplicateDeduction")
    d = ReservationDeduction(
        reservation_id=reservation_id, member_id=member.id, state="HELD", plan=_plan_json(p), use_year=use_year
    )
    session.add(d)
    await session.flush()
    for ln in p.lines:
        await _add(
            session,
            member.id,
            ln.origin_year,
            domain.EntryType.HOLD,
            -ln.nights,
            f"hold:{reservation_id}:1:{ln.origin_year}",
            use_year=use_year,
            reservation_id=reservation_id,
            note=f"Hold ({ln.kind.value})",
            user=user,
        )
    return d


async def convert_hold_to_deduction(session: AsyncSession, reservation_id: uuid.UUID, user: User) -> bool:
    """Idempotent: calling twice never deducts twice."""
    d = await active_deduction(session, reservation_id)
    if d is None:
        raise RuleViolation("No entitlement hold found for this reservation", code="NoHold")
    if d.state == "DEDUCTED":
        return False
    for y, n in _plan_years(d).items():
        await _add(
            session,
            d.member_id,
            y,
            domain.EntryType.HOLD_RELEASE,
            n,
            f"hold-release:{reservation_id}:{d.revision}:{y}",
            use_year=d.use_year,
            reservation_id=reservation_id,
            user=user,
        )
        await _add(
            session,
            d.member_id,
            y,
            domain.EntryType.DEDUCTION,
            -n,
            f"deduct:{reservation_id}:{d.revision}:{y}",
            use_year=d.use_year,
            reservation_id=reservation_id,
            user=user,
        )
    d.state = "DEDUCTED"
    audit.record(
        session,
        "ENTITLEMENT_DEDUCTED",
        f"Entitlement deducted: {d.plan['lines']}",
        entity_type="reservations",
        entity_id=reservation_id,
        member_id=d.member_id,
    )
    return True


async def release(session: AsyncSession, reservation_id: uuid.UUID, user: User, why: str) -> None:
    d = await active_deduction(session, reservation_id)
    if d is None:
        return
    if d.state == "HELD":
        for y, n in _plan_years(d).items():
            await _add(
                session,
                d.member_id,
                y,
                domain.EntryType.HOLD_RELEASE,
                n,
                f"release:{reservation_id}:{d.revision}:{y}",
                use_year=d.use_year,
                reservation_id=reservation_id,
                note=why,
                user=user,
            )
    else:  # DEDUCTED -> full credit back (non-confirmed cancellations, D-13)
        for y, n in _plan_years(d).items():
            await _add(
                session,
                d.member_id,
                y,
                domain.EntryType.CREDIT_BACK,
                n,
                f"credit:{reservation_id}:{d.revision}:{y}",
                use_year=d.use_year,
                reservation_id=reservation_id,
                note=why,
                user=user,
            )
    d.state = "RELEASED"
    audit.record(
        session,
        "ENTITLEMENT_RELEASED",
        f"Entitlement released ({why})",
        entity_type="reservations",
        entity_id=reservation_id,
        member_id=d.member_id,
    )


def cancellation_preview(
    d: ReservationDeduction | None,
    cancel_date: date,
    check_in: date,
    tiers: list[domain.CancellationTier],
    rounding: str,
) -> dict[str, Any]:
    """What cancel_with_tiers would credit, without changing anything (shown before the user cancels)."""
    if d is None:
        return {"deducted": "0.0", "credited": "0.0", "forfeited": "0.0", "tier_percent": None}
    taken = _plan_years(d)
    total = nights(sum(taken.values(), ZERO))
    if d.state == "HELD":
        return {"deducted": str(total), "credited": str(total), "forfeited": "0.0", "tier_percent": "100"}
    credit, _per_year, tier = domain.cancellation_credit(taken, cancel_date, check_in, tiers, rounding)
    return {
        "deducted": str(total),
        "credited": str(nights(credit)),
        "forfeited": str(nights(total - credit)),
        "tier_percent": format(tier.credit_percent.normalize(), "f"),  # "50", "100" (not "1E+2")
    }


async def cancel_with_tiers(
    session: AsyncSession,
    reservation_id: uuid.UUID,
    cancel_date: date,
    check_in: date,
    tiers: list[domain.CancellationTier],
    rounding: str,
    user: User,
) -> dict[str, Any]:
    d = await active_deduction(session, reservation_id)
    if d is None:
        return {"credited": "0", "tier": None}
    taken = _plan_years(d)
    credit, per_year, tier = domain.cancellation_credit(taken, cancel_date, check_in, tiers, rounding)
    if d.state == "HELD":  # never deducted: release the full hold
        await release(session, reservation_id, user, "Cancelled before approval")
        return {"credited": str(sum(taken.values(), ZERO)), "tier": "HOLD_RELEASED"}
    for y, n in per_year.items():
        await _add(
            session,
            d.member_id,
            y,
            domain.EntryType.CREDIT_BACK,
            n,
            f"cancel-credit:{reservation_id}:{d.revision}:{y}",
            use_year=d.use_year,
            reservation_id=reservation_id,
            note=f"Cancellation credit {tier.credit_percent}%",
            user=user,
        )
    d.state = "CANCELLED"
    forfeited = nights(sum(taken.values(), ZERO) - credit)
    audit.record(
        session,
        "ENTITLEMENT_CANCEL_CREDIT",
        f"Cancellation {(check_in - cancel_date).days} days before check-in: {tier.credit_percent}% -> "
        f"{credit} night(s) credited, {forfeited} forfeited",
        entity_type="reservations",
        entity_id=reservation_id,
        member_id=d.member_id,
    )
    return {"credited": str(credit), "forfeited": str(forfeited), "tier": str(tier.credit_percent)}


async def reschedule_adjust(
    session: AsyncSession, reservation_id: uuid.UUID, new_plan: domain.ConsumptionPlan, new_use_year: int, user: User
) -> dict[int, Decimal]:
    """Adjusts the *existing* movement by the difference; never creates a second deduction."""
    d = await active_deduction(session, reservation_id)
    if d is None:
        raise RuleViolation("No active entitlement movement to adjust", code="NoHold")
    diff = domain.adjustment_entries(_plan_years(d), new_plan.by_year())
    d.revision += 1
    held = d.state == "HELD"
    for y, delta in diff.items():
        etype = (
            (domain.EntryType.HOLD_RELEASE if delta > 0 else domain.EntryType.HOLD)
            if held
            else domain.EntryType.DEDUCTION_ADJUST
        )
        await _add(
            session,
            d.member_id,
            y,
            etype,
            delta,
            f"resched:{reservation_id}:{d.revision}:{y}",
            use_year=new_use_year,
            reservation_id=reservation_id,
            note="Reschedule adjustment",
            user=user,
        )
    d.plan = _plan_json(new_plan)
    d.use_year = new_use_year
    return diff


async def expire_saved(session: AsyncSession, member: Member, on: date) -> list[domain.LedgerEntry]:
    await lock_member_buckets(session, member.id)
    pol = await policy_for(session, member)
    out = domain.expiry_entries(await entries(session, member.id), on, pol)
    for e in out:
        if await _add(
            session,
            member.id,
            e.origin_year,
            domain.EntryType.EXPIRED,
            e.delta,
            f"expire:{member.id}:{e.origin_year}",
            note="Save window closed",
        ):
            audit.record(
                session,
                "ENTITLEMENT_EXPIRED",
                f"{-e.delta} saved night(s) from {e.origin_year} expired",
                entity_type="members",
                entity_id=member.id,
                member_id=member.id,
            )
    return out


async def manual_adjust(
    session: AsyncSession, member: Member, year: int, delta: Decimal, reason: str, user: User
) -> None:
    if not member.first_year_of_use <= year <= member.last_year_of_use:
        raise RuleViolation("Year outside membership period", code="OutsideMembershipPeriod")
    await lock_member_buckets(session, member.id)
    bal = domain.balances(await entries(session, member.id)).get(year, ZERO)
    if bal + delta < ZERO:
        raise RuleViolation("Adjustment would make the balance negative", code="NegativeBalance")
    await _add(
        session,
        member.id,
        year,
        domain.EntryType.MANUAL_ADJUSTMENT,
        delta,
        f"manual:{uuid.uuid4()}",
        note=reason,
        user=user,
    )
    audit.record(
        session,
        "ENTITLEMENT_OVERRIDE",
        f"Manual entitlement adjustment {delta} for {year}: {reason}",
        entity_type="members",
        entity_id=member.id,
        member_id=member.id,
    )


async def view(session: AsyncSession, member: Member, today: date) -> list[domain.YearView]:
    return domain.year_views(await entries(session, member.id), await policy_for(session, member), today)
