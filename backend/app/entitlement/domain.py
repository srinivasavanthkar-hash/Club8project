"""Pure entitlement rules.

Model
-----
Nights live in *buckets* keyed by their origin membership year. A membership year is the
calendar year (DECISIONS D-07). Each ledger entry carries a signed `delta` against one bucket:

    ALLOCATION(+) BONUS(+) HOLD(-) HOLD_RELEASE(+) DEDUCTION(-) DEDUCTION_ADJUST(+/-)
    CREDIT_BACK(+) EXPIRED(-) MANUAL_ADJUSTMENT(+/-)

Available nights in a bucket = sum(delta). A booking whose check-in falls in use-year Y may draw on:
  * SAVED buckets     Y-save_years .. Y-1 (not yet expired)
  * CURRENT bucket    Y
  * BORROWED buckets  Y+1 .. Y+borrow_years (never beyond last year of use)
Default consumption order: oldest saved -> current -> borrowed (nearest first).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum

from app.core.errors import RuleViolation
from app.core.money import ZERO, nights, round_to_half_night


class EntryType(StrEnum):
    ALLOCATION = "ALLOCATION"
    BONUS = "BONUS"
    HOLD = "HOLD"
    HOLD_RELEASE = "HOLD_RELEASE"
    DEDUCTION = "DEDUCTION"
    DEDUCTION_ADJUST = "DEDUCTION_ADJUST"
    CREDIT_BACK = "CREDIT_BACK"
    EXPIRED = "EXPIRED"
    MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT"


class BucketKind(StrEnum):
    SAVED = "SAVED"
    CURRENT = "CURRENT"
    BORROWED = "BORROWED"


@dataclass(frozen=True)
class LedgerEntry:
    origin_year: int
    entry_type: EntryType
    delta: Decimal
    use_year: int | None = None  # year of stay for HOLD/DEDUCTION/CREDIT_BACK entries
    reservation_ref: str | None = None


@dataclass(frozen=True)
class EntitlementPolicy:
    first_year: int
    last_year: int
    save_years: int = 2
    borrow_years: int = 2
    consumption_order: tuple[BucketKind, ...] = (BucketKind.SAVED, BucketKind.CURRENT, BucketKind.BORROWED)


def balances(entries: Iterable[LedgerEntry]) -> dict[int, Decimal]:
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for e in entries:
        out[e.origin_year] = nights(out[e.origin_year] + e.delta)
    return dict(out)


def is_expired(origin_year: int, on: date, save_years: int) -> bool:
    """A bucket may be used until 31-Dec of origin_year + save_years."""
    return on.year > origin_year + save_years


def eligible_buckets(use_year: int, on: date, policy: EntitlementPolicy) -> list[tuple[int, BucketKind]]:
    if not policy.first_year <= use_year <= policy.last_year:
        raise RuleViolation(
            f"Stay year {use_year} is outside the membership period {policy.first_year}-{policy.last_year}",
            code="OutsideMembershipPeriod",
        )
    saved = [
        (y, BucketKind.SAVED)
        for y in range(use_year - policy.save_years, use_year)
        if y >= policy.first_year
        and not is_expired(y, on, policy.save_years)
        and not is_expired(y, date(use_year, 1, 1), policy.save_years)
    ]
    current = [(use_year, BucketKind.CURRENT)]
    borrowed = [
        (y, BucketKind.BORROWED)
        for y in range(use_year + 1, use_year + policy.borrow_years + 1)
        if y <= policy.last_year
    ]
    groups = {BucketKind.SAVED: saved, BucketKind.CURRENT: current, BucketKind.BORROWED: borrowed}
    ordered: list[tuple[int, BucketKind]] = []
    for kind in policy.consumption_order:
        ordered.extend(groups[kind])
    return ordered


@dataclass(frozen=True)
class PlanLine:
    origin_year: int
    kind: BucketKind
    nights: Decimal


@dataclass(frozen=True)
class ConsumptionPlan:
    lines: list[PlanLine]
    entitlement_nights: Decimal
    shortfall: Decimal  # nights not covered by entitlement; may be booked as paid ADDITIONAL_NIGHTS

    def by_year(self) -> dict[int, Decimal]:
        return {ln.origin_year: ln.nights for ln in self.lines}


def plan_consumption(
    required: Decimal,
    use_year: int,
    on: date,
    available: Mapping[int, Decimal],
    policy: EntitlementPolicy,
) -> ConsumptionPlan:
    required = nights(required)
    if required <= ZERO:
        raise RuleViolation("Nights to deduct must be positive", code="NightsPositive")
    remaining = required
    lines: list[PlanLine] = []
    for year, kind in eligible_buckets(use_year, on, policy):
        if remaining <= ZERO:
            break
        avail = available.get(year, ZERO)
        take = min(avail, remaining)
        if take > ZERO:
            lines.append(PlanLine(year, kind, nights(take)))
            remaining = nights(remaining - take)
    used = nights(required - remaining)
    return ConsumptionPlan(lines, used, remaining)


# ---------------------------------------------------------------- deduction matrix
@dataclass(frozen=True)
class MatrixRule:
    """None means wildcard. More specific rules (fewer wildcards) win."""

    booked_category: str | None
    booked_season: str | None
    booked_unit_type: str | None
    purchased_category: str | None
    purchased_season: str | None
    purchased_unit_type: str | None
    multiplier: Decimal

    def matches(self, booked: tuple[str, str, str], purchased: tuple[str, str, str]) -> bool:
        pairs = zip(
            (
                self.booked_category,
                self.booked_season,
                self.booked_unit_type,
                self.purchased_category,
                self.purchased_season,
                self.purchased_unit_type,
            ),
            (*booked, *purchased),
            strict=True,
        )
        return all(want is None or want == have for want, have in pairs)

    @property
    def specificity(self) -> int:
        return sum(
            x is not None
            for x in (
                self.booked_category,
                self.booked_season,
                self.booked_unit_type,
                self.purchased_category,
                self.purchased_season,
                self.purchased_unit_type,
            )
        )


@dataclass(frozen=True)
class DeductionCalc:
    stay_nights: int
    multiplier: Decimal
    nights_to_deduct: Decimal
    explanation: str


def calculate_deduction(
    stay_nights: int,
    booked: tuple[str, str, str],  # (category, season, unit_type) codes
    purchased: tuple[str, str, str],
    rules: Sequence[MatrixRule],
    rounding_mode: str = "UP",
) -> DeductionCalc:
    if stay_nights < 1:
        raise RuleViolation("Stay must be at least one night", code="StayNights")
    candidates = [r for r in rules if r.matches(booked, purchased)]
    if candidates:
        best = max(candidates, key=lambda r: r.specificity)
        mult = best.multiplier
        src = "matrix rule"
    elif booked == purchased:
        mult, src = Decimal(1), "default 1:1 (booking matches purchase)"
    else:
        raise RuleViolation(
            "No deduction-matrix rule is configured for booking "
            f"{'/'.join(booked)} against purchased {'/'.join(purchased)}",
            code="NoDeductionRule",
        )
    deduct = round_to_half_night(Decimal(stay_nights) * mult, rounding_mode)
    return DeductionCalc(
        stay_nights,
        mult,
        deduct,
        f"{stay_nights} night(s) x {mult} ({src}; booked {'/'.join(booked)}, purchased "
        f"{'/'.join(purchased)}) = {deduct} entitlement night(s)",
    )


# ---------------------------------------------------------------- reschedule adjust
def adjustment_entries(old: Mapping[int, Decimal], new: Mapping[int, Decimal]) -> dict[int, Decimal]:
    """Delta per bucket to move an existing deduction from `old` to `new` (never a second deduction).

    Positive delta = nights returned to bucket, negative = more nights taken.
    """
    out: dict[int, Decimal] = {}
    for y in set(old) | set(new):
        d = nights(old.get(y, ZERO) - new.get(y, ZERO))
        if d != ZERO:
            out[y] = d
    return out


# ---------------------------------------------------------------- cancellation credit
@dataclass(frozen=True)
class CancellationTier:
    min_days: int  # inclusive
    max_days: int | None  # inclusive; None = open-ended
    credit_percent: Decimal


DEFAULT_TIERS = (  # seed values; boundary decision D-11: exactly 30 and exactly 15 days -> 50%
    CancellationTier(31, None, Decimal(100)),
    CancellationTier(15, 30, Decimal(50)),
    CancellationTier(0, 14, Decimal(0)),
)


def cancellation_credit(
    deducted_by_year: Mapping[int, Decimal],
    cancel_date: date,
    check_in: date,
    tiers: Sequence[CancellationTier],
    rounding_mode: str = "DOWN",
) -> tuple[Decimal, dict[int, Decimal], CancellationTier]:
    """Returns (total credited, credit per bucket, tier applied).

    Credit is rounded to the half night (default DOWN, D-12) and returned to buckets in reverse
    consumption order (latest origin year first), never more than was taken from each bucket.
    """
    days = (check_in - cancel_date).days
    tier = next((t for t in tiers if days >= t.min_days and (t.max_days is None or days <= t.max_days)), None)
    if tier is None:
        tier = CancellationTier(days, days, ZERO)  # e.g. cancelled after check-in
    total = sum(deducted_by_year.values(), ZERO)
    credit = round_to_half_night(total * tier.credit_percent / Decimal(100), rounding_mode)
    per_year: dict[int, Decimal] = {}
    left = credit
    for y in sorted(deducted_by_year, reverse=True):
        if left <= ZERO:
            break
        give = min(deducted_by_year[y], left)
        per_year[y] = nights(give)
        left = nights(left - give)
    return credit, per_year, tier


# ---------------------------------------------------------------- expiry
def expiry_entries(entries: Iterable[LedgerEntry], on: date, policy: EntitlementPolicy) -> list[LedgerEntry]:
    """EXPIRED entries for every bucket whose save window has closed and still has a positive balance.
    Idempotent: once expired the balance is zero so nothing more is produced."""
    out = []
    for year, bal in sorted(balances(entries).items()):
        if bal > ZERO and is_expired(year, on, policy.save_years):
            out.append(LedgerEntry(year, EntryType.EXPIRED, -bal))
    return out


# ---------------------------------------------------------------- member view
@dataclass
class YearView:
    year: int
    allocated: Decimal = ZERO
    bonus: Decimal = ZERO
    saved_in: Decimal = ZERO  # nights from earlier years used for stays in this year
    used: Decimal = ZERO  # this bucket's nights deducted for stays in this year
    used_later: Decimal = ZERO  # this bucket's nights used in later years (saved)
    borrowed_out: Decimal = ZERO  # this bucket's nights used for stays in earlier years
    on_hold: Decimal = ZERO
    credited_back: Decimal = ZERO
    expired: Decimal = ZERO
    adjustments: Decimal = ZERO
    remaining: Decimal = ZERO
    flags: list[str] = field(default_factory=list)


def year_views(entries: Sequence[LedgerEntry], policy: EntitlementPolicy, today: date) -> list[YearView]:
    views = {y: YearView(y) for y in range(policy.first_year, policy.last_year + 1)}
    for e in entries:
        v = views.setdefault(e.origin_year, YearView(e.origin_year))
        t = e.entry_type
        if t is EntryType.ALLOCATION:
            v.allocated += e.delta
        elif t is EntryType.BONUS:
            v.bonus += e.delta
        elif t in (EntryType.HOLD, EntryType.HOLD_RELEASE):
            v.on_hold -= e.delta
        elif t in (EntryType.DEDUCTION, EntryType.DEDUCTION_ADJUST):
            n = -e.delta
            uy = e.use_year if e.use_year is not None else e.origin_year
            if uy == e.origin_year:
                v.used += n
            elif uy > e.origin_year:
                v.used_later += n
                if uy in views:
                    views[uy].saved_in += n
            else:
                v.borrowed_out += n
        elif t is EntryType.CREDIT_BACK:
            v.credited_back += e.delta
        elif t is EntryType.EXPIRED:
            v.expired -= e.delta
        else:
            v.adjustments += e.delta
    bal = balances(entries)
    for y, v in views.items():
        v.remaining = nights(bal.get(y, ZERO))
        if is_expired(y, today, policy.save_years):
            v.flags.append("EXPIRED_WINDOW")
    return [views[y] for y in sorted(views)]
