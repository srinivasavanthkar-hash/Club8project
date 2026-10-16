from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.errors import RuleViolation
from app.entitlement.domain import (
    DEFAULT_TIERS,
    BucketKind,
    EntitlementPolicy,
    EntryType,
    LedgerEntry,
    MatrixRule,
    adjustment_entries,
    balances,
    calculate_deduction,
    cancellation_credit,
    eligible_buckets,
    expiry_entries,
    plan_consumption,
    year_views,
)

POLICY = EntitlementPolicy(first_year=2026, last_year=2035)


def alloc(year, n=7):
    return LedgerEntry(year, EntryType.ALLOCATION, D(n))


# ------------------------------------------------------------------ buckets / order
def test_eligible_bucket_order_saved_current_borrowed():
    b = eligible_buckets(2028, date(2028, 3, 1), POLICY)
    assert b == [
        (2026, BucketKind.SAVED),
        (2027, BucketKind.SAVED),
        (2028, BucketKind.CURRENT),
        (2029, BucketKind.BORROWED),
        (2030, BucketKind.BORROWED),
    ]


def test_borrow_never_beyond_last_year_and_no_saved_before_first():
    assert eligible_buckets(2035, date(2035, 1, 1), POLICY)[-1] == (2035, BucketKind.CURRENT)
    assert eligible_buckets(2026, date(2026, 1, 1), POLICY)[0] == (2026, BucketKind.CURRENT)


def test_stay_outside_membership_rejected():
    with pytest.raises(RuleViolation):
        eligible_buckets(2036, date(2036, 1, 1), POLICY)


def test_consumption_oldest_saved_first_then_current_then_borrowed():
    avail = {2026: D(2), 2027: D(3), 2028: D(7), 2029: D(7)}
    plan = plan_consumption(D(14), 2028, date(2028, 1, 10), avail, POLICY)
    assert [(ln.origin_year, ln.kind, ln.nights) for ln in plan.lines] == [
        (2026, BucketKind.SAVED, D(2)),
        (2027, BucketKind.SAVED, D(3)),
        (2028, BucketKind.CURRENT, D(7)),
        (2029, BucketKind.BORROWED, D(2)),
    ]
    assert plan.shortfall == 0


def test_consumption_shortfall_becomes_additional_nights():
    plan = plan_consumption(D(10), 2026, date(2026, 1, 10), {2026: D(7)}, EntitlementPolicy(2026, 2026))
    assert plan.entitlement_nights == D(7) and plan.shortfall == D(3)


@given(req=st.integers(1, 40), a=st.integers(0, 10), b=st.integers(0, 10), c=st.integers(0, 10))
def test_consumption_property_never_overdraws(req, a, b, c):
    avail = {2027: D(a), 2028: D(b), 2029: D(c)}
    plan = plan_consumption(D(req), 2028, date(2028, 1, 1), avail, POLICY)
    for ln in plan.lines:
        assert ln.nights <= avail[ln.origin_year]
    assert plan.entitlement_nights + plan.shortfall == D(req)


# ------------------------------------------------------------------ matrix
RULES = [
    MatrixRule("SUPREME", None, None, "PREMIUM", None, None, D("1.5")),
    MatrixRule("SUPREME", "RED", None, "PREMIUM", None, None, D("2")),
    MatrixRule(None, "BLUE", None, None, "RED", None, D("0.5")),
]


def test_matrix_default_one_to_one():
    c = calculate_deduction(4, ("PREMIUM", "RED", "T0"), ("PREMIUM", "RED", "T0"), [])
    assert c.nights_to_deduct == D(4) and "1:1" in c.explanation


def test_matrix_most_specific_rule_wins():
    c = calculate_deduction(3, ("SUPREME", "RED", "T0"), ("PREMIUM", "RED", "T0"), RULES)
    assert c.multiplier == D(2) and c.nights_to_deduct == D(6)


def test_matrix_half_night_rounding_up():
    c = calculate_deduction(3, ("SUPREME", "WHITE", "T0"), ("PREMIUM", "RED", "T0"), RULES)
    assert c.nights_to_deduct == D("4.5")
    c = calculate_deduction(3, ("PREMIUM", "BLUE", "T0"), ("PREMIUM", "RED", "T0"), RULES)
    assert c.nights_to_deduct == D("1.5")


def test_matrix_missing_rule_is_error():
    with pytest.raises(RuleViolation):
        calculate_deduction(3, ("CLASSIC", "WHITE", "T1"), ("PREMIUM", "RED", "T0"), RULES)


# ------------------------------------------------------------------ reschedule
def test_reschedule_adjusts_existing_deduction_by_difference():
    assert adjustment_entries({2026: D(4)}, {2026: D(6)}) == {2026: D(-2)}
    assert adjustment_entries({2026: D(4)}, {2026: D(4)}) == {}
    assert adjustment_entries({2026: D(4)}, {2027: D(4)}) == {2026: D(4), 2027: D(-4)}


# ------------------------------------------------------------------ cancellation tiers
@pytest.mark.parametrize(
    "days,credit", [(31, D(7)), (30, D("3.5")), (15, D("3.5")), (14, D(0)), (0, D(0)), (200, D(7))]
)
def test_cancellation_tiers_and_boundaries(days, credit):
    check_in = date(2027, 6, 30)
    from datetime import timedelta

    total, per_year, _ = cancellation_credit({2027: D(7)}, check_in - timedelta(days=days), check_in, DEFAULT_TIERS)
    assert total == credit
    assert sum(per_year.values(), D(0)) == credit


def test_cancellation_half_rounding_down_on_odd_half_nights():
    total, _, _ = cancellation_credit({2027: D("4.5")}, date(2027, 6, 1), date(2027, 6, 20), DEFAULT_TIERS)
    assert total == D("2.0")  # 50% of 4.5 = 2.25 -> rounds down to 2.0


def test_cancellation_credit_returns_to_latest_bucket_first():
    _, per_year, _ = cancellation_credit({2026: D(2), 2027: D(5)}, date(2027, 6, 1), date(2027, 6, 20), DEFAULT_TIERS)
    assert per_year == {2027: D("3.5")}


def test_cancellation_after_check_in_credits_nothing():
    total, _, _ = cancellation_credit({2027: D(5)}, date(2027, 7, 2), date(2027, 7, 1), DEFAULT_TIERS)
    assert total == 0


# ------------------------------------------------------------------ expiry / views
def test_expiry_after_two_years_idempotent():
    entries = [alloc(2026), LedgerEntry(2026, EntryType.DEDUCTION, D(-3), 2026)]
    assert expiry_entries(entries, date(2028, 12, 31), POLICY) == []
    exp = expiry_entries(entries, date(2029, 1, 1), POLICY)
    assert exp == [LedgerEntry(2026, EntryType.EXPIRED, D(-4))]
    assert expiry_entries(entries + exp, date(2029, 1, 2), POLICY) == []


def test_year_views():
    entries = [
        alloc(2026),
        alloc(2027),
        LedgerEntry(2026, EntryType.BONUS, D(3)),
        LedgerEntry(2026, EntryType.DEDUCTION, D(-4), 2026),
        LedgerEntry(2026, EntryType.DEDUCTION, D(-2), 2027),  # saved into 2027
        LedgerEntry(2027, EntryType.DEDUCTION, D(-1), 2026),  # borrowed by 2026
        LedgerEntry(2027, EntryType.HOLD, D(-2), 2027),
        LedgerEntry(2026, EntryType.CREDIT_BACK, D(1), 2026),
    ]
    v = {y.year: y for y in year_views(entries, POLICY, date(2027, 1, 1))}
    assert v[2026].allocated == 7 and v[2026].bonus == 3 and v[2026].used == 4
    assert v[2026].used_later == 2 and v[2027].saved_in == 2 and v[2027].borrowed_out == 1
    assert v[2027].on_hold == 2 and v[2026].credited_back == 1
    assert v[2026].remaining == D(5) and v[2027].remaining == D(4)
    assert balances(entries) == {2026: D(5), 2027: D(4)}
