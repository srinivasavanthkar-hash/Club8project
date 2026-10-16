from datetime import date
from decimal import Decimal as D

import pytest

from app.audit.hashchain import GENESIS, compute_hash, verify_chain
from app.core.errors import RuleViolation
from app.core.money import format_inr, round_to_half_night
from app.core.state_machine import lead_sm, member_sm, reservation_sm
from app.core.timeutil import add_working_days
from app.core.validators import (
    mask_aadhaar,
    normalize_phone,
    validate_aadhaar,
    validate_adult,
    validate_mobile,
    validate_pan,
    validate_pin,
    verhoeff_check_digit,
)
from app.members.domain import (
    PersonKey,
    activation_blockers,
    balance_mode_check,
    find_duplicates,
    last_year_of_use,
    membership_number_search_forms,
    price_summary,
)
from app.reservations.domain import (
    BookingWindow,
    OccupancyRule,
    SeasonPeriod,
    booking_window_warnings,
    check_occupancy,
    check_reschedule_limit,
    confirmation_blockers,
    derive_season,
    gift_rent_requirements,
    stay_nights,
)


# ------------------------------------------------------------------ validators
def test_phone_normalisation():
    for raw in ["+91 98450 12345", "098450-12345", "919845012345", "9845012345", "0091 9845012345"]:
        assert normalize_phone(raw) == "9845012345"
    assert normalize_phone("+44 20 7946 0000") == "+442079460000"
    assert validate_mobile("+91 9845012345") == "9845012345"
    with pytest.raises(ValueError):
        validate_mobile("12345")


def test_aadhaar_verhoeff_and_mask():
    base = "23456789012"
    good = base + verhoeff_check_digit(base)
    assert validate_aadhaar(good) == good
    bad = base + str((int(good[-1]) + 1) % 10)
    with pytest.raises(ValueError):
        validate_aadhaar(bad)
    assert mask_aadhaar(good) == f"XXXX-XXXX-{good[-4:]}"


def test_pan_pin_adult():
    assert validate_pan("abcde1234f") == "ABCDE1234F"
    for bad in ["ABCD1234F", "12345ABCDE"]:
        with pytest.raises(ValueError):
            validate_pan(bad)
    assert validate_pin("560001") == "560001"
    with pytest.raises(ValueError):
        validate_pin("56001")
    validate_adult(date(2008, 10, 15), date(2026, 10, 15))
    with pytest.raises(ValueError):
        validate_adult(date(2008, 10, 16), date(2026, 10, 15))


def test_money_helpers():
    assert format_inr(D("255000")) == "₹2,55,000.00"
    assert format_inr(D("12345678.5")) == "₹1,23,45,678.50"
    assert format_inr(D("999")) == "₹999.00"
    assert round_to_half_night(D("2.25")) == D("2.0")
    assert round_to_half_night(D("2.25"), "UP") == D("2.5")


# ------------------------------------------------------------------ state machines
def test_lead_transitions():
    lead_sm.check("NEW", "CONTACTED")
    lead_sm.check("ATTENDED", "CONVERTED")
    with pytest.raises(RuleViolation):
        lead_sm.check("NEW", "CONVERTED")
    with pytest.raises(RuleViolation):
        lead_sm.check("CONVERTED", "NEW")


def test_member_and_reservation_transitions():
    member_sm.check("PENDING_APPROVAL", "ACTIVE")
    member_sm.check("DEFAULT_NOTICE", "TERMINATED")
    with pytest.raises(RuleViolation):
        member_sm.check("ACTIVE", "TERMINATED")
    reservation_sm.check("APPROVED", "CONFIRMED")
    with pytest.raises(RuleViolation):
        reservation_sm.check("REQUESTED", "CONFIRMED")
    with pytest.raises(RuleViolation):
        reservation_sm.check("CANCELLED", "REQUESTED")


# ------------------------------------------------------------------ membership
def test_tenure_and_price():
    assert last_year_of_use(2026, 10) == 2035
    p = price_summary(D("250000"), D("5000"), D("55000"))
    assert p.total_price == D("255000.00") and p.balance == D("200000.00")
    assert price_summary(D("100"), D("0"), D("100")).balance_display == "NIL"
    with pytest.raises(RuleViolation):
        price_summary(D("100"), D("0"), D("101"))


def test_balance_mode():
    balance_mode_check(D(0), "NONE", None, None, None)
    balance_mode_check(D(100), "EMI", D(10), 10, (2026, 1))
    with pytest.raises(RuleViolation):
        balance_mode_check(D(100), "NONE", None, None, None)
    with pytest.raises(RuleViolation):
        balance_mode_check(D(100), "EMI", None, 10, (2026, 1))


def test_activation_blockers():
    assert (
        activation_blockers(
            missing_fields=[],
            down_payment_recorded=True,
            signed_agreement_uploaded=True,
            require_signed_agreement=True,
            kyc_ok=True,
        )
        == []
    )
    b = activation_blockers(
        missing_fields=["purchase_date"],
        down_payment_recorded=False,
        signed_agreement_uploaded=False,
        require_signed_agreement=True,
        kyc_ok=False,
    )
    assert len(b) == 4
    assert (
        activation_blockers(
            missing_fields=[],
            down_payment_recorded=True,
            signed_agreement_uploaded=False,
            require_signed_agreement=False,
            kyc_ok=True,
        )
        == []
    )


def test_duplicate_detection():
    existing = [
        PersonKey("L-2026-000001", "LEAD", "Test Person", None, ("+91 98450 00001",), "a@example.com"),
        PersonKey(
            "MSMC8-9001", "MEMBER", "Asha Demo", date(1990, 1, 1), ("9845000002",), None, "ABCDE1234F", "MSMC8-9001"
        ),
    ]
    m = find_duplicates(PersonKey("new", "LEAD", "x", None, ("09845000001",), "A@Example.com "), existing)
    assert m[0].reasons == ("mobile", "email") and not m[0].hard
    m = find_duplicates(
        PersonKey("new", "MEMBER", "asha  demo", date(1990, 1, 1), (), None, "abcde1234f", "msmc8-9001"), existing
    )
    assert m[0].hard and set(m[0].reasons) == {"membership number", "PAN", "name + date of birth"}
    assert find_duplicates(PersonKey("n", "LEAD", "Nobody", None, ("9000000000",)), existing) == []


def test_membership_number_search_forms():
    assert membership_number_search_forms("9030") == ("9030", "9030")
    assert membership_number_search_forms("msmc8-9030") == ("MSMC8-9030", "9030")


# ------------------------------------------------------------------ reservations
HOLIDAYS = {date(2026, 10, 20)}


def test_working_days():
    # Thu 15-Oct-2026 + 7 working days (Sun off, 20-Oct holiday) -> 24-Oct
    assert add_working_days(date(2026, 10, 15), 7, HOLIDAYS) == date(2026, 10, 24)


def test_booking_window():
    w = BookingWindow()
    req = date(2026, 10, 15)
    assert booking_window_warnings(req, date(2026, 10, 24), w, HOLIDAYS) == []
    assert "7 working days" in booking_window_warnings(req, date(2026, 10, 23), w, HOLIDAYS)[0]
    assert booking_window_warnings(req, date(2027, 10, 15), w, HOLIDAYS) == []
    assert "12 months" in booking_window_warnings(req, date(2027, 10, 16), w, HOLIDAYS)[0]


STUDIO = OccupancyRule(max_adults=2, max_children=2, child_age_limit=10, max_total=4)
ONE_BED = OccupancyRule(max_adults=4, max_children=0, child_age_limit=10, max_total=4)


def test_occupancy():
    assert check_occupancy(2, [3, 9], STUDIO).ok
    r = check_occupancy(2, [3, 10], STUDIO)  # a 10-year-old counts as adult
    assert not r.ok and r.adults_effective == 3
    assert not check_occupancy(1, [1, 2, 3], STUDIO).ok
    assert check_occupancy(4, [], ONE_BED).ok
    assert check_occupancy(4, [], STUDIO, rooms=2).ok
    with pytest.raises(RuleViolation):
        check_occupancy(0, [], STUDIO)


def test_stay_and_season():
    assert stay_nights(date(2027, 1, 1), date(2027, 1, 5)) == 4
    with pytest.raises(RuleViolation):
        stay_nights(date(2027, 1, 5), date(2027, 1, 5))
    cal = [
        SeasonPeriod("RED", date(2027, 12, 20), date(2027, 12, 31)),
        SeasonPeriod("WHITE", date(2027, 10, 1), date(2027, 12, 19)),
        SeasonPeriod("BLUE", date(2027, 1, 1), date(2027, 9, 30)),
    ]
    assert derive_season(date(2027, 12, 18), date(2027, 12, 22), cal) == "RED"
    assert derive_season(date(2027, 3, 1), date(2027, 3, 4), cal) == "BLUE"
    assert derive_season(date(2028, 3, 1), date(2028, 3, 4), cal) is None


def test_reschedule_limit():
    check_reschedule_limit(1, 2, False)
    with pytest.raises(RuleViolation):
        check_reschedule_limit(2, 2, False)
    check_reschedule_limit(2, 2, True)


def test_confirmation_gate_and_gift():
    assert confirmation_blockers("CNF-1", []) == []
    assert len(confirmation_blockers("", [2027])) == 2
    assert gift_rent_requirements("SELF", None, None, False) == []
    assert len(gift_rent_requirements("GIFT", None, None, False)) == 2
    assert gift_rent_requirements("RENT", "Guest", "9000000000", True) == []


# ------------------------------------------------------------------ audit hash chain
def _chain(n):
    rows, prev = [], GENESIS
    for i in range(1, n + 1):
        r = {
            "seq": i,
            "occurred_at": "2026-10-15T00:00:00",
            "user_id": "u",
            "action": "UPDATE",
            "entity_type": "member",
            "entity_id": str(i),
            "entity_ref": None,
            "member_id": None,
            "summary": f"edit {i}",
            "changes": {"x": [i, i + 1]},
            "ip": None,
            "user_agent": None,
        }
        r["prev_hash"], r["hash"] = prev, compute_hash(prev, r)
        prev = r["hash"]
        rows.append(r)
    return rows


def test_hash_chain_detects_tampering():
    rows = _chain(5)
    assert verify_chain(rows).ok
    rows[2]["summary"] = "tampered"
    v = verify_chain(rows)
    assert not v.ok and v.first_broken_seq == 3
    rows = _chain(5)
    del rows[1]
    assert not verify_chain(rows).ok


def test_every_api_route_commits_before_responding():
    """Regression: yield-dependency teardown runs after the response is sent, so commits must happen in
    TransactionalRoute (otherwise clients can read-after-write a 404, or miss a failed commit)."""
    from fastapi.routing import APIRoute

    from app.core.db import TransactionalRoute
    from app.main import app

    def walk(routes):  # FastAPI >= 0.14x wraps included routers lazily (original_router)
        for r in routes:
            inner = getattr(r, "original_router", None)
            if inner is not None:
                yield from walk(inner.routes)
            else:
                yield r

    api_routes = [r for r in walk(app.routes) if isinstance(r, APIRoute) and r.path not in ("/healthz", "/readyz")]
    assert api_routes
    assert [r.path for r in api_routes if not isinstance(r, TransactionalRoute)] == []
