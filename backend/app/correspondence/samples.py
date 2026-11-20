"""Fictitious sample data for previewing letter templates (Admin > Letter templates) and for the rendering tests.

Never real member data: names, numbers and addresses here are invented.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

SAMPLE_COMPANY = SimpleNamespace(
    legal_name="Example Leisure LLP",
    brand="Example Holidays",
    registered_address="12 Sample Road, Pune 411001",
    gstin="27ABCDE1234F1Z5",
    logo_path="club8/club8-logo.png",
    primary_colour="#393186",
    accent_colour="#EF7F1B",
    details_pending_confirmation=False,
)
SAMPLE_MEMBER = SimpleNamespace(
    membership_number="C8-TEST-0001", address_line1="4 Test Lane", city="Nashik", currency="INR"
)
SAMPLE_RESERVATION = SimpleNamespace(
    reservation_number="RS-2027-000123",
    confirmation_number="CNF-4567",
    check_in=date(2027, 1, 10),
    check_out=date(2027, 1, 13),
    nights=3,
    adults=2,
    child_ages=[6],
    guest_name="Asha Example",
)
SAMPLE_NAME = "Asha Example"


def sample_payment(**kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "receipt_number": "RC8-2027-000042",
        "payment_date": date(2027, 1, 5),
        "asf_year": None,
        "base_amount": Decimal("255000"),
        "gst_amount": Decimal("0"),
        "gst_rate": Decimal("0"),
        "total_amount": Decimal("255000"),
        "currency": "INR",
        "card_last4": None,
        "transaction_ref": "UTR-TEST-1",
        "cheque_number": None,
    }
    return SimpleNamespace(**(base | kw))


def sample_cancellation() -> dict[str, Any]:
    return {
        "request_kind": "email",
        "request_received_on": date(2026, 12, 19),
        "confirmed_on": date(2026, 11, 1),
        "cancel_date": date(2026, 12, 19),
        "date_source": "REQUEST",
        "date_reason": None,
        "notice_days": 22,
        "tier_percent": 50,
        "deducted": Decimal("3"),
        "credited": Decimal("1.5"),
        "forfeited": Decimal("1.5"),
        "reason": "Change of plans",
        "reason_text": None,
        "asf_withdrawn": [],
        "asf_paid": [],
        "voucher_voided": True,
    }


def sample_context(code: str, company: Any = None) -> dict[str, Any]:
    """Everything a template of this code may use, with fictitious values. Unknown codes get the union."""
    base: dict[str, Any] = {"company": company or SAMPLE_COMPANY, "m": SAMPLE_MEMBER, "name": SAMPLE_NAME}
    by_code: dict[str, dict[str, Any]] = {
        "RECEIPT": {"p": sample_payment(), "payment_type": "Down payment", "method": "UPI"},
        "DEFAULT_NOTICE": {
            "days": 30,
            "notice": SimpleNamespace(
                issued_on=date(2027, 2, 1), amount_overdue=Decimal("125000"), deadline=date(2027, 3, 3)
            ),
        },
        "RESERVATION_VOUCHER": {"r": SAMPLE_RESERVATION, "property": "Sample Hill Resort"},
        "CANCELLATION_LETTER": {
            "r": SAMPLE_RESERVATION,
            "property": "Sample Hill Resort",
            "issued_on": date(2026, 12, 20),
            "c": sample_cancellation(),
        },
    }
    if code in by_code:
        return base | by_code[code]
    merged = dict(base)
    for extra in by_code.values():
        merged |= extra
    return merged
