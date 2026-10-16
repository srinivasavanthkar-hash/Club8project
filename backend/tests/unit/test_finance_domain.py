from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.errors import RuleViolation
from app.finance.domain import (
    AsfChargeState,
    AsfRate,
    ExistingAsf,
    InstalmentStatus,
    OpenInstalment,
    allocate_payment,
    asf_rate_cap_check,
    decide_asf,
    default_notice_deadline,
    default_notice_state,
    generate_emi_schedule,
    gst_for,
    instalment_status,
    totals_by_type_and_currency,
)


# ------------------------------------------------------------------ EMI
def test_emi_exact_split():
    plan = generate_emi_schedule(D("120000"), D("10000"), 12, 2026, 11)
    assert plan.warning is None
    assert [i.amount_due for i in plan.instalments] == [D("10000.00")] * 12
    assert plan.instalments[0].due_date == date(2026, 11, 1)
    assert plan.instalments[2].due_date == date(2027, 1, 1)


def test_emi_final_instalment_adjusted_with_warning():
    plan = generate_emi_schedule(D("100000"), D("8333"), 12, 2026, 11)
    assert plan.warning and "final instalment adjusted" in plan.warning
    assert plan.instalments[-1].amount_due == D("100000") - D("8333") * 11
    assert sum(i.amount_due for i in plan.instalments) == D("100000.00")


def test_emi_adjusts_down_when_overshooting():
    plan = generate_emi_schedule(D("1000"), D("300"), 4, 2026, 1)
    assert plan.instalments[-1].amount_due == D("100.00")


def test_emi_rejects_impossible_plan():
    with pytest.raises(RuleViolation):
        generate_emi_schedule(D("1000"), D("600"), 3, 2026, 1)


@pytest.mark.parametrize("bal,emi,n", [(D("0"), D("1"), 1), (D("10"), D("0"), 1), (D("10"), D("1"), 0)])
def test_emi_invalid_inputs(bal, emi, n):
    with pytest.raises(RuleViolation):
        generate_emi_schedule(bal, emi, n, 2026, 1)


@given(
    balance=st.decimals(min_value=D("1000"), max_value=D("5000000"), places=2),
    count=st.integers(min_value=1, max_value=60),
)
def test_emi_property_schedule_always_sums_to_balance(balance, count):
    emi = (balance / count).quantize(D("0.01"))
    plan = generate_emi_schedule(balance, emi, count, 2026, 3)
    assert sum(i.amount_due for i in plan.instalments) == balance
    assert all(i.amount_due > 0 for i in plan.instalments)
    assert len(plan.instalments) == count


# ------------------------------------------------------------------ allocation
def _inst(i, amt="1000", paid="0", due=None):
    return OpenInstalment(i, i, due or date(2026, i, 1), D(amt), D(paid))


def test_allocation_oldest_first_partial():
    res = allocate_payment(D("1500"), [_inst(2), _inst(1)])
    assert [(a.instalment_id, a.amount) for a in res.allocations] == [(1, D("1000.00")), (2, D("500.00"))]
    assert res.credit == 0


def test_allocation_overpayment_becomes_credit():
    res = allocate_payment(D("2500"), [_inst(1), _inst(2, paid="400")])
    assert sum(a.amount for a in res.allocations) == D("1600.00")
    assert res.credit == D("900.00")


def test_allocation_to_specific_targets():
    res = allocate_payment(D("1000"), [_inst(1), _inst(2)], targets=[2])
    assert [(a.instalment_id, a.amount) for a in res.allocations] == [(2, D("1000.00"))]


def test_allocation_bad_target_and_amount():
    with pytest.raises(RuleViolation):
        allocate_payment(D("10"), [_inst(1)], targets=[99])
    with pytest.raises(RuleViolation):
        allocate_payment(D("0"), [_inst(1)])


@given(amount=st.decimals(min_value=D("0.01"), max_value=D("100000"), places=2))
def test_allocation_property_conserves_money(amount):
    insts = [_inst(i, amt="1234.56", paid="10.00") for i in range(1, 6)]
    res = allocate_payment(amount, insts)
    assert sum(a.amount for a in res.allocations) + res.credit == amount
    assert all(a.amount > 0 for a in res.allocations)


def test_instalment_status():
    today = date(2026, 6, 15)
    assert instalment_status(D(100), D(100), date(2026, 1, 1), today) is InstalmentStatus.PAID
    assert instalment_status(D(100), D(0), date(2026, 6, 14), today) is InstalmentStatus.OVERDUE
    assert instalment_status(D(100), D(50), date(2026, 6, 14), today) is InstalmentStatus.OVERDUE
    assert instalment_status(D(100), D(50), date(2026, 6, 15), today) is InstalmentStatus.PART_PAID
    assert instalment_status(D(100), D(0), date(2026, 7, 1), today) is InstalmentStatus.PENDING


# ------------------------------------------------------------------ GST
def test_gst_only_where_applicable():
    assert gst_for(True, D("10000"), D("5")) == (D("5"), D("500.00"), D("10500.00"))
    assert gst_for(False, D("10000"), D("5")) == (D("0"), D("0"), D("10000.00"))


# ------------------------------------------------------------------ ASF
RATE = AsfRate(D("12000"), D("5"))


def _rate(_d):
    return RATE


def test_asf_raised_once_per_year_at_first_booking():
    first = decide_asf(booking_date=date(2027, 2, 1), years_used=[(2027, "CURRENT")], existing=[], rate_on=_rate)
    assert [(c.membership_year, c.total) for c in first.to_raise] == [(2027, D("12600.00"))]
    second = decide_asf(
        booking_date=date(2027, 5, 1),
        years_used=[(2027, "CURRENT")],
        existing=[ExistingAsf(2027, AsfChargeState.PAID)],
        rate_on=_rate,
    )
    assert second.to_raise == [] and second.link_existing == [2027]


def test_asf_borrowed_year_raised_at_current_rate():
    rates = {date(2027, 3, 1): AsfRate(D("12000"), D("5"))}
    d = decide_asf(
        booking_date=date(2027, 3, 1),
        years_used=[(2027, "CURRENT"), (2028, "BORROWED")],
        existing=[],
        rate_on=lambda x: rates[x],
    )
    assert [(c.membership_year, c.base, c.reason) for c in d.to_raise] == [
        (2027, D("12000.00"), "CURRENT"),
        (2028, D("12000.00"), "BORROWED"),
    ]


def test_asf_rate_is_rate_on_booking_date():
    seen = []

    def rate_on(d):
        seen.append(d)
        return AsfRate(D("13000"), D("5"))

    decide_asf(booking_date=date(2029, 1, 10), years_used=[(2030, "BORROWED")], existing=[], rate_on=rate_on)
    assert seen == [date(2029, 1, 10)]


def test_asf_saved_nights_not_recharged_when_source_paid():
    d = decide_asf(
        booking_date=date(2028, 1, 5),
        years_used=[(2027, "SAVED")],
        existing=[ExistingAsf(2027, AsfChargeState.PAID)],
        rate_on=_rate,
    )
    assert d.to_raise == [] and d.link_existing == [2027]


def test_asf_saved_from_unbooked_year_configurable():
    yes = decide_asf(booking_date=date(2028, 1, 5), years_used=[(2027, "SAVED")], existing=[], rate_on=_rate)
    assert yes.to_raise[0].reason == "SAVED_SOURCE_UNRAISED"
    no = decide_asf(
        booking_date=date(2028, 1, 5),
        years_used=[(2027, "SAVED")],
        existing=[],
        rate_on=_rate,
        charge_unraised_saved_source=False,
    )
    assert no.to_raise == []


def test_asf_multi_year_booking_separate_lines_dedup():
    d = decide_asf(
        booking_date=date(2027, 1, 5),
        years_used=[(2027, "CURRENT"), (2027, "CURRENT"), (2028, "BORROWED")],
        existing=[ExistingAsf(2027, AsfChargeState.RAISED)],
        rate_on=_rate,
    )
    assert [c.membership_year for c in d.to_raise] == [2028]
    assert d.link_existing == [2027]


def test_asf_rate_cap_warning():
    assert asf_rate_cap_check(None, D("12000"), D("5")) is None
    assert asf_rate_cap_check(D("12000"), D("12600"), D("5")) is None  # exactly 5% ok
    w = asf_rate_cap_check(D("12000"), D("12601"), D("5"))
    assert w and "exceeds" in w


# ------------------------------------------------------------------ default notice
def test_default_notice_timeline():
    issued = date(2026, 6, 1)
    assert default_notice_deadline(issued, 14) == date(2026, 6, 15)
    assert default_notice_state(issued, 14, D("5000"), date(2026, 6, 15)) == "OPEN"
    assert default_notice_state(issued, 14, D("5000"), date(2026, 6, 16)) == "EXPIRED"
    assert default_notice_state(issued, 14, D("0"), date(2026, 6, 10)) == "CURED"


def test_totals_never_mix_currencies():
    t = totals_by_type_and_currency(
        [
            ("INR", "ASF", D("100"), D("5")),
            ("USD", "ASF", D("10"), D("0")),
            ("INR", "ASF", D("100"), D("5")),
            ("INR", "MEMBERSHIP_EMI", D("50"), D("0")),
        ]
    )
    assert t["INR"]["ASF"] == {"base": D("200.00"), "gst": D("10.00"), "total": D("210.00")}
    assert t["USD"]["ASF"]["total"] == D("10.00")
    assert t["INR"]["MEMBERSHIP_EMI"]["gst"] == 0
