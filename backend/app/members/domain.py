"""Pure membership rules: tenure arithmetic, price totals, activation gate, duplicate scoring."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.core.errors import RuleViolation
from app.core.money import ZERO, money
from app.core.validators import normalize_email, normalize_name, normalize_phone


def last_year_of_use(first_year: int, tenure_years: int) -> int:
    """Default D-05: inclusive counting, last = first + tenure - 1 (editable with a reason)."""
    if tenure_years < 1:
        raise RuleViolation("Tenure must be at least 1 year", code="Tenure")
    return first_year + tenure_years - 1


@dataclass(frozen=True)
class PriceSummary:
    purchase_price: Decimal
    admin_fees: Decimal
    total_price: Decimal
    down_payment: Decimal
    balance: Decimal

    @property
    def balance_display(self) -> str:
        return "NIL" if self.balance == ZERO else str(self.balance)


def price_summary(purchase_price: Decimal, admin_fees: Decimal, down_payment: Decimal) -> PriceSummary:
    pp, af, dp = money(purchase_price), money(admin_fees), money(down_payment)
    if pp < ZERO or af < ZERO or dp < ZERO:
        raise RuleViolation("Amounts cannot be negative", code="NegativeAmount")
    total = money(pp + af)
    if dp > total:
        raise RuleViolation("Down payment cannot exceed the total purchase price", code="DownPaymentTooHigh")
    return PriceSummary(pp, af, total, dp, money(total - dp))


def balance_mode_check(
    balance: Decimal, mode: str, emi_amount: Decimal | None, emi_count: int | None, emi_start: tuple[int, int] | None
) -> None:
    if balance == ZERO:
        if mode not in ("NONE",):
            raise RuleViolation("Balance is NIL; balance mode must be NONE", code="BalanceMode")
        return
    if mode == "NONE":
        raise RuleViolation("Balance is outstanding; choose EMI or OTHER", code="BalanceMode")
    if mode == "EMI" and (not emi_amount or not emi_count or not emi_start):
        raise RuleViolation("EMI amount, number of EMIs and starting month/year are required", code="EmiFields")


def activation_blockers(
    *,
    missing_fields: list[str],
    down_payment_recorded: bool,
    signed_agreement_uploaded: bool,
    require_signed_agreement: bool,
    kyc_ok: bool,
) -> list[str]:
    out = []
    if missing_fields:
        out.append("Mandatory fields incomplete: " + ", ".join(missing_fields))
    if not down_payment_recorded:
        out.append("Down payment has not been recorded in Finance")
    if require_signed_agreement and not signed_agreement_uploaded:
        out.append("Signed membership agreement has not been uploaded")
    if not kyc_ok:
        out.append("Each applicant needs at least one KYC identifier")
    return out


# ---------------------------------------------------------------- duplicates
@dataclass(frozen=True)
class PersonKey:
    ref: str  # lead id or membership number
    kind: str  # LEAD | MEMBER
    name: str | None = None
    dob: date | None = None
    mobiles: tuple[str, ...] = ()
    email: str | None = None
    pan: str | None = None  # plain PAN only for comparison in memory (hash in DB)
    membership_number: str | None = None


@dataclass(frozen=True)
class DuplicateMatch:
    ref: str
    kind: str
    reasons: tuple[str, ...]
    hard: bool


def find_duplicates(candidate: PersonKey, existing: Iterable[PersonKey]) -> list[DuplicateMatch]:
    c_mobiles = {normalize_phone(m) for m in candidate.mobiles if m}
    c_email = normalize_email(candidate.email)
    c_name = normalize_name(candidate.name) if candidate.name else None
    out = []
    for e in existing:
        reasons = []
        hard = False
        if (
            candidate.membership_number
            and e.membership_number
            and candidate.membership_number.upper() == e.membership_number.upper()
        ):
            reasons.append("membership number")
            hard = True
        if c_mobiles & {normalize_phone(m) for m in e.mobiles if m}:
            reasons.append("mobile")
        if c_email and c_email == normalize_email(e.email):
            reasons.append("email")
        if candidate.pan and e.pan and candidate.pan.upper() == e.pan.upper():
            reasons.append("PAN")
        if (
            c_name
            and e.name
            and candidate.dob
            and e.dob
            and c_name == normalize_name(e.name)
            and candidate.dob == e.dob
        ):
            reasons.append("name + date of birth")
        if reasons:
            out.append(DuplicateMatch(e.ref, e.kind, tuple(reasons), hard))
    return out


def membership_number_search_forms(q: str) -> tuple[str, str]:
    """'9030' and 'MSMC8-9030' both resolve: returns (full_upper, numeric_part)."""
    s = q.strip().upper()
    num = s.rsplit("-", 1)[-1] if "-" in s else s
    return s, num
