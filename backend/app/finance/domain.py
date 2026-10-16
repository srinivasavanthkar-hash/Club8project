"""Pure finance rules: EMI schedule, payment allocation, instalment status, GST, ASF and rate-cap.

No I/O here. Services load configuration (rates, tax) and pass it in.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum

from app.core.errors import RuleViolation
from app.core.money import ZERO, money
from app.core.timeutil import add_months


class InstalmentStatus(StrEnum):
    PENDING = "PENDING"
    PART_PAID = "PART_PAID"
    PAID = "PAID"
    OVERDUE = "OVERDUE"


# ---------------------------------------------------------------- EMI schedule
@dataclass(frozen=True)
class PlannedInstalment:
    number: int
    due_date: date
    amount_due: Decimal


@dataclass(frozen=True)
class EmiPlan:
    instalments: list[PlannedInstalment]
    warning: str | None  # set when EMI x count != balance and the final instalment was adjusted


def generate_emi_schedule(
    balance: Decimal, emi_amount: Decimal, count: int, start_year: int, start_month: int, due_day: int = 1
) -> EmiPlan:
    balance, emi_amount = money(balance), money(emi_amount)
    if balance <= ZERO:
        raise RuleViolation("Balance must be positive to generate an EMI schedule", code="EmiNoBalance")
    if count < 1:
        raise RuleViolation("Number of EMIs must be at least 1", code="EmiCount")
    if emi_amount <= ZERO:
        raise RuleViolation("EMI amount must be positive", code="EmiAmount")
    if not 1 <= start_month <= 12 or not 1 <= due_day <= 28:
        raise RuleViolation("Start month must be 1-12 and due day 1-28", code="EmiStart")

    expected = money(emi_amount * count)
    warning = None
    last = emi_amount
    if expected != balance:
        last = money(balance - emi_amount * (count - 1))
        if last <= ZERO:
            raise RuleViolation(
                "EMI amount x (count-1) already exceeds the balance; reduce EMI amount or count",
                code="EmiExceedsBalance",
            )
        warning = (
            f"EMI {emi_amount} x {count} = {expected} does not equal balance {balance}; "
            f"final instalment adjusted to {last}"
        )
    first_due = date(start_year, start_month, due_day)
    items = [
        PlannedInstalment(i + 1, add_months(first_due, i), last if i == count - 1 else emi_amount) for i in range(count)
    ]
    assert sum((i.amount_due for i in items), ZERO) == balance
    return EmiPlan(items, warning)


# ---------------------------------------------------------------- allocation
@dataclass
class OpenInstalment:
    id: object
    number: int
    due_date: date
    amount_due: Decimal
    amount_paid: Decimal

    @property
    def outstanding(self) -> Decimal:
        return money(self.amount_due - self.amount_paid)


@dataclass(frozen=True)
class Allocation:
    instalment_id: object
    amount: Decimal


@dataclass(frozen=True)
class AllocationResult:
    allocations: list[Allocation]
    credit: Decimal  # overpayment carried forward as member credit


def allocate_payment(
    amount: Decimal, instalments: Sequence[OpenInstalment], targets: Sequence[object] | None = None
) -> AllocationResult:
    """Allocate oldest-due first (or only to `targets`, in their given order). Excess becomes credit."""
    remaining = money(amount)
    if remaining <= ZERO:
        raise RuleViolation("Payment amount must be positive", code="PaymentAmount")
    pool = sorted(instalments, key=lambda i: (i.due_date, i.number))
    if targets is not None:
        by_id = {i.id: i for i in pool}
        missing = [t for t in targets if t not in by_id]
        if missing:
            raise RuleViolation("Allocation target is not an open instalment of this schedule", code="AllocTarget")
        pool = [by_id[t] for t in targets]
    out: list[Allocation] = []
    for inst in pool:
        if remaining <= ZERO:
            break
        take = min(inst.outstanding, remaining)
        if take > ZERO:
            out.append(Allocation(inst.id, take))
            remaining = money(remaining - take)
    return AllocationResult(out, remaining)


def instalment_status(amount_due: Decimal, amount_paid: Decimal, due_date: date, today: date) -> InstalmentStatus:
    if amount_paid >= amount_due:
        return InstalmentStatus.PAID
    if due_date < today:
        return InstalmentStatus.OVERDUE
    if amount_paid > ZERO:
        return InstalmentStatus.PART_PAID
    return InstalmentStatus.PENDING


# ---------------------------------------------------------------- GST
def gst_for(payment_type_gst_applicable: bool, base: Decimal, gst_rate: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """Returns (gst_rate_applied, gst_amount, total). GST applies only where the payment type says so (ASF)."""
    base = money(base)
    if not payment_type_gst_applicable:
        return money(ZERO), money(ZERO), base
    gst = money(base * gst_rate / Decimal(100))
    return gst_rate, gst, money(base + gst)


# ---------------------------------------------------------------- ASF
@dataclass(frozen=True)
class AsfRate:
    amount: Decimal
    gst_rate: Decimal  # percent, e.g. 5
    currency: str = "INR"


class AsfChargeState(StrEnum):
    NOT_YET_DUE = "NOT_YET_DUE"
    RAISED = "RAISED"  # raised, unpaid / part paid
    PAID = "PAID"


@dataclass(frozen=True)
class ExistingAsf:
    membership_year: int
    state: AsfChargeState


@dataclass(frozen=True)
class AsfToRaise:
    membership_year: int
    base: Decimal
    gst_rate: Decimal
    gst: Decimal
    total: Decimal
    currency: str
    reason: str  # CURRENT | BORROWED | SAVED_SOURCE_UNRAISED


@dataclass(frozen=True)
class AsfDecision:
    to_raise: list[AsfToRaise]
    link_existing: list[int] = field(default_factory=list)  # years whose existing charge is linked to booking


def decide_asf(
    *,
    booking_date: date,
    years_used: Iterable[tuple[int, str]],  # (membership/origin year, kind CURRENT|BORROWED|SAVED)
    existing: Iterable[ExistingAsf],
    rate_on: Callable[[date], AsfRate],
    charge_unraised_saved_source: bool = True,
) -> AsfDecision:
    """ASF rules (confirmed by Club8, 13-Oct-2026):

    * one flat charge per membership year, raised the first time a booking uses that year's nights;
    * rate = rate effective on the booking date (also for borrowed and saved years);
    * borrowed future year -> full ASF of that year raised now at the current rate;
    * saved nights -> no new charge if the source year's ASF exists; if never raised,
      raise it now (configurable, pending OPEN_QUESTIONS #7).
    """
    have = {e.membership_year: e.state for e in existing}
    rate = rate_on(booking_date)
    to_raise: list[AsfToRaise] = []
    link: list[int] = []
    seen: set[int] = set()
    for year, kind in sorted(years_used):
        if year in seen:
            continue
        seen.add(year)
        state = have.get(year, AsfChargeState.NOT_YET_DUE)
        if state is not AsfChargeState.NOT_YET_DUE:
            link.append(year)
            continue
        if kind == "SAVED" and not charge_unraised_saved_source:
            continue
        _, gst, total = gst_for(True, rate.amount, rate.gst_rate)
        reason = {"CURRENT": "CURRENT", "BORROWED": "BORROWED"}.get(kind, "SAVED_SOURCE_UNRAISED")
        to_raise.append(AsfToRaise(year, money(rate.amount), rate.gst_rate, gst, total, rate.currency, reason))
    return AsfDecision(to_raise, link)


def asf_rate_cap_check(previous_amount: Decimal | None, new_amount: Decimal, cap_percent: Decimal) -> str | None:
    """Agreement caps annual ASF revision at a percentage (default 5%). Returns warning text or None."""
    if previous_amount is None or previous_amount <= ZERO:
        return None
    increase = (money(new_amount) - money(previous_amount)) / money(previous_amount) * Decimal(100)
    if increase > cap_percent:
        return (
            f"ASF increase of {increase.quantize(Decimal('0.01'))}% exceeds the {cap_percent}% annual cap "
            f"in the membership agreement; an override reason is required"
        )
    return None


# ---------------------------------------------------------------- default notice
def default_notice_deadline(issued_on: date, window_days: int) -> date:
    from datetime import timedelta

    return issued_on + timedelta(days=window_days)


def default_notice_state(issued_on: date, window_days: int, outstanding_overdue: Decimal, today: date) -> str:
    """CURED if paid in full within the window; EXPIRED (termination allowed) after the deadline; else OPEN."""
    deadline = default_notice_deadline(issued_on, window_days)
    if outstanding_overdue <= ZERO:
        return "CURED"
    if today > deadline:
        return "EXPIRED"
    return "OPEN"


def totals_by_type_and_currency(
    rows: Iterable[tuple[str, str, Decimal, Decimal]],
) -> dict[str, dict[str, dict[str, Decimal]]]:
    """rows: (currency, payment_type, base, gst) -> {currency: {type: {base, gst, total}}}.

    Amounts in different currencies are never summed together.
    """
    out: dict[str, dict[str, dict[str, Decimal]]] = {}
    for cur, ptype, base, gst in rows:
        bucket = out.setdefault(cur, {}).setdefault(ptype, {"base": ZERO, "gst": ZERO, "total": ZERO})
        bucket["base"] = money(bucket["base"] + base)
        bucket["gst"] = money(bucket["gst"] + gst)
        bucket["total"] = money(bucket["base"] + bucket["gst"])
    return out
