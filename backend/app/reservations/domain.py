"""Pure reservation rules: booking window, occupancy, season derivation, reschedule limit, ASF gate."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from app.core.errors import RuleViolation
from app.core.timeutil import add_months, add_working_days, fmt_date


@dataclass(frozen=True)
class BookingWindow:
    min_working_days: int = 7
    max_months: int = 12


def booking_window_warnings(
    request_date: date,
    check_in: date,
    window: BookingWindow,
    holidays: Collection[date],
    weekend: Collection[int] = (6,),
) -> list[str]:
    """Warnings only (agreement: company will try to fulfil subject to availability). Override reason needed."""
    warnings = []
    earliest = add_working_days(request_date, window.min_working_days, holidays, weekend)
    latest = add_months(request_date, window.max_months)
    if check_in < earliest:
        warnings.append(
            f"Check-in is less than {window.min_working_days} working days after the request "
            f"(earliest {fmt_date(earliest)})"
        )
    if check_in > latest:
        warnings.append(
            f"Check-in is more than {window.max_months} months after the request (latest {fmt_date(latest)})"
        )
    return warnings


def stay_nights(check_in: date, check_out: date) -> int:
    n = (check_out - check_in).days
    if n < 1:
        raise RuleViolation("Check-out must be after check-in", code="StayDates")
    return n


@dataclass(frozen=True)
class OccupancyRule:
    max_adults: int
    max_children: int
    child_age_limit: int  # children aged >= limit count as adults
    max_total: int


@dataclass(frozen=True)
class OccupancyResult:
    ok: bool
    adults_effective: int
    children_effective: int
    problems: list[str]


def check_occupancy(adults: int, child_ages: Sequence[int], rule: OccupancyRule, rooms: int = 1) -> OccupancyResult:
    if adults < 1:
        raise RuleViolation("At least one adult is required", code="OccupancyAdults")
    if any(a < 0 for a in child_ages):
        raise RuleViolation("Child age cannot be negative", code="ChildAge")
    rooms = max(rooms, 1)
    older = sum(1 for a in child_ages if a >= rule.child_age_limit)
    eff_adults = adults + older
    eff_children = len(child_ages) - older
    problems = []
    if eff_adults > rule.max_adults * rooms:
        problems.append(
            f"{eff_adults} adult(s) (incl. children aged {rule.child_age_limit}+) exceed "
            f"the limit of {rule.max_adults * rooms}"
        )
    if eff_children > rule.max_children * rooms:
        problems.append(
            f"{eff_children} child(ren) under {rule.child_age_limit} exceed the limit of {rule.max_children * rooms}"
        )
    if eff_adults + eff_children > rule.max_total * rooms:
        problems.append(f"Total occupancy {eff_adults + eff_children} exceeds {rule.max_total * rooms}")
    return OccupancyResult(not problems, eff_adults, eff_children, problems)


@dataclass(frozen=True)
class SeasonPeriod:
    season_code: str
    start: date
    end: date  # inclusive


def derive_season(check_in: date, check_out: date, calendar: Iterable[SeasonPeriod]) -> str | None:
    """Season of the stay = the highest-priority season touched by any night (calendar order = priority,
    Red before White before Blue). None if the calendar has no coverage (user must pick manually)."""
    periods = list(calendar)
    found: list[int] = []
    d = check_in
    while d < check_out:
        for idx, p in enumerate(periods):
            if p.start <= d <= p.end:
                found.append(idx)
                break
        d += timedelta(days=1)
    if not found:
        return None
    return periods[min(found)].season_code


def check_reschedule_limit(reschedules_so_far: int, max_reschedules: int, has_override: bool) -> None:
    if reschedules_so_far >= max_reschedules and not has_override:
        raise RuleViolation(
            f"Maximum of {max_reschedules} reschedules reached; reservation.override is required",
            code="RescheduleLimit",
        )


def confirmation_blockers(confirmation_number: str | None, unpaid_asf_years: Sequence[int]) -> list[str]:
    out = []
    if not confirmation_number or not confirmation_number.strip():
        out.append("A property confirmation number is required")
    if unpaid_asf_years:
        out.append(
            "ASF unpaid for membership year(s) "
            + ", ".join(map(str, sorted(unpaid_asf_years)))
            + " - non-payment of ASF results in non-confirmation"
        )
    return out


def gift_rent_requirements(
    occupancy_type: str, guest_name: str | None, guest_contact: str | None, has_member_communication: bool
) -> list[str]:
    if occupancy_type not in ("GIFT", "RENT"):
        return []
    out = []
    if not guest_name or not guest_contact:
        out.append("Lead guest name and contact are required for Gift/Rent bookings")
    if not has_member_communication:
        out.append("Link the member's email or call informing the company of the Gift/Rent booking")
    return out
