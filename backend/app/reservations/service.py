"""Reservation workflow. Entitlement and ASF movements happen in the same transaction as the status change."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import (
    CancellationTier,
    DeductionMatrix,
    HolidayCalendar,
    Property,
    Reason,
    ResortCategory,
    Season,
    SeasonCalendar,
    UnitType,
)
from app.audit import service as audit
from app.auth.models import User
from app.core.errors import OverrideRequired, RuleViolation
from app.core.money import ZERO, nights
from app.core.repository import get_or_404
from app.core.sequences import reservation_number
from app.core.settings_store import get_settings_map
from app.core.state_machine import reservation_sm
from app.core.timeutil import today_ist
from app.correspondence.models import Call, Document, Email
from app.entitlement import domain as ent
from app.entitlement import service as ent_service
from app.finance import service as fin
from app.members.models import Member
from app.reservations import domain
from app.reservations.models import Reservation, ReservationDateVersion, ReservationStatusHistory
from app.reservations.schemas import RescheduleIn, ReservationIn, StatusChangeIn


@dataclass
class QuoteResult:
    stay_nights: int
    season_code: str | None
    season_derived: bool
    booked: tuple[str, str, str]
    purchased: tuple[str, str, str]
    calc: ent.DeductionCalc | None
    plan: ent.ConsumptionPlan | None
    use_year: int
    asf: list[dict[str, Any]]
    window_warnings: list[str]
    occupancy: domain.OccupancyResult | None
    gift_rent_problems: list[str]
    blocking: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "stay_nights": self.stay_nights,
            "season_code": self.season_code,
            "season_derived": self.season_derived,
            "booked": list(self.booked),
            "purchased": list(self.purchased),
            "multiplier": self.calc.multiplier if self.calc else ZERO,
            "entitlement_nights_required": self.calc.nights_to_deduct if self.calc else ZERO,
            "explanation": self.calc.explanation if self.calc else "",
            "plan": [
                {"year": ln.origin_year, "kind": ln.kind.value, "nights": str(ln.nights)}
                for ln in (self.plan.lines if self.plan else [])
            ],
            "entitlement_nights": self.plan.entitlement_nights if self.plan else ZERO,
            "additional_paid_nights": self.plan.shortfall if self.plan else ZERO,
            "asf": self.asf,
            "window_warnings": self.window_warnings,
            "occupancy_problems": self.occupancy.problems if self.occupancy else [],
            "gift_rent_problems": self.gift_rent_problems,
            "blocking": self.blocking,
        }


async def _purchased(session: AsyncSession, member: Member) -> tuple[str, str, str]:
    cat = await session.get(ResortCategory, member.resort_category_id)
    sea = await session.get(Season, member.season_id)
    ut = await session.get(UnitType, member.unit_type_id)
    assert cat and sea and ut
    return cat.code, sea.code, ut.code


async def _season(session: AsyncSession, destination_id: uuid.UUID, check_in: date, check_out: date) -> str | None:
    rows = (
        await session.execute(
            select(SeasonCalendar, Season)
            .join(Season, Season.id == SeasonCalendar.season_id)
            .where(
                SeasonCalendar.start_date <= check_out,
                SeasonCalendar.end_date >= check_in,
                or_(SeasonCalendar.destination_id == destination_id, SeasonCalendar.destination_id.is_(None)),
            )
            .order_by(SeasonCalendar.destination_id.is_(None), Season.priority)
        )
    ).all()
    periods = [domain.SeasonPeriod(s.code, c.start_date, c.end_date) for c, s in rows]
    return domain.derive_season(check_in, check_out, periods)


async def _matrix(session: AsyncSession, on: date) -> list[ent.MatrixRule]:
    rows = (
        await session.execute(
            select(DeductionMatrix).where(
                DeductionMatrix.effective_from <= on,
                or_(DeductionMatrix.effective_to.is_(None), DeductionMatrix.effective_to >= on),
            )
        )
    ).scalars()
    return [
        ent.MatrixRule(
            r.booked_category,
            r.booked_season,
            r.booked_unit_type,
            r.purchased_category,
            r.purchased_season,
            r.purchased_unit_type,
            Decimal(r.multiplier),
        )
        for r in rows
    ]


async def _communication_exists(
    session: AsyncSession, member_id: uuid.UUID, ref: str | None, kinds: tuple[str, ...]
) -> bool:
    if not ref:
        return False
    kind, _, raw = ref.partition(":")
    if kind not in kinds:
        return False
    obj: Email | Call | Document | None
    if kind == "email":
        obj = await session.get(Email, uuid.UUID(raw))
    elif kind == "call":
        obj = await session.get(Call, uuid.UUID(raw))
    else:
        obj = await session.get(Document, uuid.UUID(raw))
    return obj is not None and obj.member_id == member_id and obj.deleted_at is None


async def quote(
    session: AsyncSession, member: Member, data: ReservationIn, *, exclude_reservation: uuid.UUID | None = None
) -> QuoteResult:
    req_date = data.request_date or today_ist()
    prop = await get_or_404(session, Property, data.property_id, label="Property")
    if prop.destination_id != data.destination_id:
        raise RuleViolation("Property does not belong to the selected destination", code="PropertyDestination")
    cat = await session.get(ResortCategory, prop.resort_category_id)
    ut = await get_or_404(session, UnitType, data.unit_type_id, label="Unit type")
    assert cat is not None
    stay = domain.stay_nights(data.check_in, data.check_out)
    derived = await _season(session, data.destination_id, data.check_in, data.check_out)
    season = data.season_override_code or derived
    purchased = await _purchased(session, member)
    booked = (cat.code, season or "?", ut.code)
    blocking: list[str] = []
    calc = plan = None
    use_year = data.check_in.year
    asf: list[dict[str, Any]] = []
    if season is None:
        blocking.append("No season is configured for these dates; choose the season manually")
    else:
        try:
            calc = ent.calculate_deduction(
                stay,
                booked,
                purchased,
                await _matrix(session, req_date),
                (await get_settings_map(session, ["entitlement.deduction_rounding"]))["entitlement.deduction_rounding"],
            )
            # Each room consumes entitlement (D-15)
            required = nights(calc.nights_to_deduct * data.rooms)
            plan = await ent_service.plan(session, member, required, use_year, req_date, exclude_reservation)
            years = [(ln.origin_year, ln.kind.value) for ln in plan.lines]
            asf = await fin.preview_asf(session, member, years, req_date) if years else []
        except RuleViolation as e:
            blocking.append(e.detail)
    s = await get_settings_map(session, ["booking.min_working_days", "booking.max_months", "booking.weekend_days"])
    holidays = set((await session.execute(select(HolidayCalendar.holiday_date))).scalars())
    window = domain.booking_window_warnings(
        req_date,
        data.check_in,
        domain.BookingWindow(int(s["booking.min_working_days"]), int(s["booking.max_months"])),
        holidays,
        tuple(s["booking.weekend_days"]),
    )
    occ = domain.check_occupancy(
        data.adults,
        data.child_ages,
        domain.OccupancyRule(ut.max_adults, ut.max_children, ut.child_age_limit, ut.max_total),
        data.rooms,
    )
    gift = domain.gift_rent_requirements(
        data.occupancy_type,
        data.guest_name,
        data.guest_contact,
        await _communication_exists(session, member.id, data.member_communication_ref, ("email", "call")),
    )
    return QuoteResult(
        stay,
        season,
        derived is not None and data.season_override_code is None,
        booked,
        purchased,
        calc,
        plan,
        use_year,
        asf,
        window,
        occ,
        gift,
        blocking,
    )


def _require_member_active(member: Member) -> None:
    if member.status != "ACTIVE":
        raise RuleViolation(
            f"Reservations are only allowed for ACTIVE members (status {member.status})", code="MemberNotActive"
        )


async def create(session: AsyncSession, member_id: uuid.UUID, data: ReservationIn, user: User) -> Reservation:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    _require_member_active(member)
    await ent_service.lock_member_buckets(session, member.id)  # plan under lock: no double consumption
    q = await quote(session, member, data)
    if q.blocking:
        raise RuleViolation("; ".join(q.blocking), code="ReservationBlocked")
    overridden: dict[str, str] = {}
    if q.window_warnings:
        if not data.window_override_reason:
            raise OverrideRequired(
                "; ".join(q.window_warnings), code="BookingWindow", extra={"warnings": q.window_warnings}
            )
        for w in q.window_warnings:
            overridden[w] = data.window_override_reason
    if q.occupancy and not q.occupancy.ok:
        if data.occupancy_resolution != "UPGRADE_CHARGE":
            raise OverrideRequired(
                "; ".join(q.occupancy.problems) + ". Upgrade the unit type or add an UPGRADE_CHARGE.",
                code="Occupancy",
                extra={"problems": q.occupancy.problems},
            )
        overridden["occupancy"] = "UPGRADE_CHARGE to be recorded in Finance"
    if q.gift_rent_problems:
        raise RuleViolation("; ".join(q.gift_rent_problems), code="GiftRent")
    assert q.plan is not None and q.calc is not None
    if q.plan.shortfall > ZERO and not data.accept_additional_paid_nights:
        raise OverrideRequired(
            f"Only {q.plan.entitlement_nights} entitlement night(s) available; "
            f"{q.plan.shortfall} night(s) must be booked as paid ADDITIONAL_NIGHTS",
            code="InsufficientEntitlement",
            extra={"shortfall": str(q.plan.shortfall)},
        )
    if q.plan.entitlement_nights == ZERO:
        raise RuleViolation("No entitlement nights available for this stay", code="NoEntitlement")
    today = data.request_date or today_ist()
    r = Reservation(
        reservation_number=await reservation_number(session, today.year),
        member_id=member.id,
        request_date=today,
        destination_id=data.destination_id,
        property_id=data.property_id,
        resort_category_code=q.booked[0],
        season_code=q.season_code or "",
        season_overridden=data.season_override_code is not None,
        unit_type_id=data.unit_type_id,
        rooms=data.rooms,
        adults=data.adults,
        child_ages=data.child_ages,
        occupancy_type=data.occupancy_type,
        guest_name=data.guest_name,
        guest_contact=data.guest_contact,
        member_communication_ref=data.member_communication_ref,
        check_in=data.check_in,
        check_out=data.check_out,
        nights=q.stay_nights,
        entitlement_nights=q.plan.entitlement_nights,
        additional_paid_nights=q.plan.shortfall,
        deduction_explanation=q.calc.explanation,
        status="REQUESTED",
        remarks=data.remarks,
        warnings_overridden=overridden or None,
        created_by=user.id,
        updated_by=user.id,
    )
    session.add(r)
    await session.flush()
    session.add(
        ReservationDateVersion(
            reservation_id=r.id,
            version_no=1,
            check_in=r.check_in,
            check_out=r.check_out,
            entitlement_nights=r.entitlement_nights,
            created_by=user.id,
            reason="Original",
        )
    )
    session.add(
        ReservationStatusHistory(
            reservation_id=r.id,
            from_status=None,
            to_status="REQUESTED",
            changed_by=user.id,
            override=bool(overridden),
            reason_text="; ".join(f"{k}: {v}" for k, v in overridden.items()) or None,
        )
    )
    await ent_service.hold(session, member, r.id, q.plan, q.use_year, user)
    await fin.raise_asf_for_booking(
        session, member, r.id, [(ln.origin_year, ln.kind.value) for ln in q.plan.lines], today
    )
    if overridden:
        audit.record(
            session,
            "RESERVATION_OVERRIDE",
            f"Reservation {r.reservation_number} created with overrides: {overridden}",
            entity_type="reservations",
            entity_id=r.id,
            entity_ref=r.reservation_number,
            member_id=member.id,
        )
    await session.flush()
    await session.refresh(r, ["status_history", "date_versions"])
    return r


async def _tiers(session: AsyncSession, on: date) -> tuple[list[ent.CancellationTier], str]:
    rows = list(
        (
            await session.execute(
                select(CancellationTier)
                .where(
                    CancellationTier.effective_from <= on,
                    or_(CancellationTier.effective_to.is_(None), CancellationTier.effective_to >= on),
                )
                .order_by(CancellationTier.min_days.desc())
            )
        ).scalars()
    )
    if not rows:
        return list(ent.DEFAULT_TIERS), "DOWN"
    return [ent.CancellationTier(r.min_days, r.max_days, Decimal(r.credit_percent)) for r in rows], rows[
        0
    ].rounding_mode


async def change_status(
    session: AsyncSession, reservation_id: uuid.UUID, data: StatusChangeIn, user: User
) -> tuple[Reservation, dict[str, Any]]:
    r = await get_or_404(session, Reservation, reservation_id, for_update=True, label="Reservation")
    member = await get_or_404(session, Member, r.member_id, for_update=True, label="Member")
    reservation_sm.check(r.status, data.to_status)
    can_override = "reservation.override" in user.permission_codes()
    extra: dict[str, Any] = {}
    override_used = False
    if data.to_status in ("DECLINED", "CANCELLED"):
        if data.reason_id is None or not data.reason_text:
            raise RuleViolation(
                "A reason from the list and a free-text explanation are required", code="ReasonRequired"
            )
        reason = await session.get(Reason, data.reason_id)
        expected = "DECLINE" if data.to_status == "DECLINED" else "CANCEL"
        if reason is None or reason.kind != expected:
            raise RuleViolation(f"Choose a {expected.lower()} reason", code="ReasonKind")
    if data.to_status in ("APPROVED", "CONFIRMED"):
        _require_member_active(member)
    await ent_service.lock_member_buckets(session, member.id)

    if data.to_status == "APPROVED":
        await ent_service.convert_hold_to_deduction(session, r.id, user)
    elif data.to_status == "CONFIRMED":
        deduction = await ent_service.active_deduction(session, r.id)
        if deduction is not None and deduction.state == "HELD":
            raise RuleViolation("Approve the reservation before confirming it", code="NotApproved")
        blockers = domain.confirmation_blockers(data.confirmation_number, await fin.unpaid_asf_years(session, r.id))
        missing_conf = not data.confirmation_number or not data.confirmation_number.strip()
        if missing_conf:
            raise RuleViolation("A property confirmation number is required", code="ConfirmationNumber")
        if blockers:
            if not (can_override and data.override_reason):
                raise RuleViolation(
                    "; ".join(blockers)
                    + ("" if can_override else ". A user with reservation.override can bypass this with a reason."),
                    code="ConfirmationBlocked",
                    extra={"blockers": blockers},
                )
            override_used = True
            audit.record(
                session,
                "RESERVATION_OVERRIDE",
                f"Confirmation of {r.reservation_number} forced despite: {blockers}. Reason: {data.override_reason}",
                entity_type="reservations",
                entity_id=r.id,
                entity_ref=r.reservation_number,
                member_id=member.id,
            )
        r.confirmation_number = data.confirmation_number.strip()  # type: ignore[union-attr]
    elif data.to_status == "DECLINED":
        await ent_service.release(session, r.id, user, "Reservation declined")
    elif data.to_status == "CANCELLED":
        cancel_date = data.cancel_date or today_ist()
        if r.status in ("CONFIRMED",) or (r.status == "RESCHEDULED" and r.confirmation_number):
            if not await _communication_exists(session, member.id, data.communication_ref, ("email", "document")):
                raise RuleViolation(
                    "Cancelling a confirmed reservation requires the member's written request: link "
                    "the email or uploaded document",
                    code="WrittenCommunicationRequired",
                )
            tiers, rounding = await _tiers(session, cancel_date)
            extra = await ent_service.cancel_with_tiers(session, r.id, cancel_date, r.check_in, tiers, rounding, user)
        else:
            await ent_service.release(session, r.id, user, "Cancelled before confirmation")
            extra = {"credited": str(r.entitlement_nights), "tier": "FULL_RELEASE"}
    old = r.status
    r.status = data.to_status
    r.updated_by = user.id
    session.add(
        ReservationStatusHistory(
            reservation_id=r.id,
            from_status=old,
            to_status=data.to_status,
            changed_by=user.id,
            reason_id=data.reason_id,
            reason_text=data.reason_text or data.override_reason,
            override=override_used,
        )
    )
    audit.record(
        session,
        "STATUS_CHANGE",
        f"Reservation {r.reservation_number}: {old} -> {data.to_status}",
        entity_type="reservations",
        entity_id=r.id,
        entity_ref=r.reservation_number,
        member_id=member.id,
        changes={"status": [old, data.to_status]},
    )
    await session.flush()
    await session.refresh(r, ["status_history", "date_versions"])
    return r, extra


async def reschedule(session: AsyncSession, reservation_id: uuid.UUID, data: RescheduleIn, user: User) -> Reservation:
    r = await get_or_404(session, Reservation, reservation_id, for_update=True, label="Reservation")
    member = await get_or_404(session, Member, r.member_id, for_update=True, label="Member")
    _require_member_active(member)
    reservation_sm.check(r.status, "RESCHEDULED")
    limit = int((await get_settings_map(session, ["reservation.max_reschedules"]))["reservation.max_reschedules"])
    can_override = "reservation.override" in user.permission_codes() and bool(data.override_reason)
    domain.check_reschedule_limit(r.reschedule_count, limit, can_override)
    await ent_service.lock_member_buckets(session, member.id)
    req = ReservationIn(
        destination_id=r.destination_id,
        property_id=r.property_id,
        unit_type_id=r.unit_type_id,
        rooms=r.rooms,
        adults=r.adults,
        child_ages=r.child_ages,
        occupancy_type=r.occupancy_type,
        guest_name=r.guest_name,
        guest_contact=r.guest_contact,
        member_communication_ref=r.member_communication_ref,
        check_in=data.check_in,
        check_out=data.check_out,
        season_override_code=r.season_code if r.season_overridden else None,
    )
    q = await quote(session, member, req, exclude_reservation=r.id)
    if q.blocking:
        raise RuleViolation("; ".join(q.blocking), code="ReservationBlocked")
    if q.window_warnings and not data.window_override_reason:
        raise OverrideRequired("; ".join(q.window_warnings), code="BookingWindow")
    assert q.plan is not None and q.calc is not None
    if q.plan.shortfall > ZERO and not data.accept_additional_paid_nights:
        raise OverrideRequired(
            f"{q.plan.shortfall} night(s) must be booked as paid ADDITIONAL_NIGHTS", code="InsufficientEntitlement"
        )
    await ent_service.reschedule_adjust(session, r.id, q.plan, q.use_year, user)
    await fin.raise_asf_for_booking(
        session, member, r.id, [(ln.origin_year, ln.kind.value) for ln in q.plan.lines], today_ist()
    )
    r.reschedule_count += 1
    version_no = len(r.date_versions) + 1
    session.add(
        ReservationDateVersion(
            reservation_id=r.id,
            version_no=version_no,
            check_in=data.check_in,
            check_out=data.check_out,
            entitlement_nights=q.plan.entitlement_nights,
            created_by=user.id,
            reason=data.reason,
        )
    )
    old = r.status
    # The reservation row shows the *current* dates; every version (incl. the original) is kept in date_versions.
    r.check_in, r.check_out, r.nights = data.check_in, data.check_out, q.stay_nights
    r.entitlement_nights, r.additional_paid_nights = q.plan.entitlement_nights, q.plan.shortfall
    r.season_code = q.season_code or r.season_code
    r.deduction_explanation = q.calc.explanation
    r.status = "RESCHEDULED"
    over = r.reschedule_count > limit
    session.add(
        ReservationStatusHistory(
            reservation_id=r.id,
            from_status=old,
            to_status="RESCHEDULED",
            changed_by=user.id,
            reason_text=data.reason + (f" | override: {data.override_reason}" if over else ""),
            override=over,
        )
    )
    audit.record(
        session,
        "RESERVATION_DATES",
        f"Reservation {r.reservation_number} rescheduled (#{r.reschedule_count})"
        f" to {data.check_in}..{data.check_out}: {data.reason}",
        entity_type="reservations",
        entity_id=r.id,
        entity_ref=r.reservation_number,
        member_id=member.id,
    )
    await session.flush()
    await session.refresh(r, ["status_history", "date_versions"])
    return r
