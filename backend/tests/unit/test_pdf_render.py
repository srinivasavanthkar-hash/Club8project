"""Every generated document type renders through the real PDF engine with the logo, ₹ and human labels.

Real WeasyPrint (Pango): runs in CI, and locally with scripts/test-pdf-render.sh (the backend Docker image). Where
the engine cannot load these tests are skipped locally but FAIL in CI, so CI can never pass without rendering.
Fictitious data only (app/correspondence/samples.py, also used by the template preview).
"""

import io
import os
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import get_settings
from app.correspondence import letters, pdf
from app.correspondence.samples import SAMPLE_MEMBER, sample_context, sample_payment

pytestmark = pytest.mark.pdf_render


@pytest.fixture(autouse=True)
def real_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "pdf_engine", "weasyprint")
    status, detail = pdf.engine_status()
    if status != "ok":
        if os.environ.get("CI"):
            pytest.fail(f"CI must render real PDFs: {detail}")
        pytest.skip(f"{detail}; run scripts/test-pdf-render.sh (backend Docker image)")


def _ctx(code: str, **over: Any) -> dict[str, Any]:
    return sample_context(code) | over


DOCUMENTS: dict[str, tuple[str, dict[str, Any], list[str]]] = {
    "receipt (down payment)": (
        "RECEIPT",
        _ctx("RECEIPT"),
        ["Payment Receipt", "RC8-2027-000042", "Down payment", "₹2,55,000.00", "05-01-2027"],
    ),
    "receipt (EMI)": (
        "RECEIPT",
        _ctx(
            "RECEIPT",
            p=sample_payment(base_amount=Decimal("12500"), total_amount=Decimal("12500")),
            payment_type="Membership EMI",
            method="Card",
        ),
        ["Membership EMI", "₹12,500.00"],
    ),
    "receipt (ASF with GST)": (
        "RECEIPT",
        _ctx(
            "RECEIPT",
            p=sample_payment(
                asf_year=2027,
                base_amount=Decimal("15000"),
                gst_amount=Decimal("750"),
                gst_rate=Decimal("5.00"),
                total_amount=Decimal("15750"),
            ),
            payment_type="Annual Subscription Fee",
        ),
        ["Annual Subscription Fee", "membership year 2027", "GST @ 5%", "₹750.00", "₹15,750.00"],
    ),
    "default notice": ("DEFAULT_NOTICE", _ctx("DEFAULT_NOTICE"), ["Notice of Default", "₹1,25,000.00", "03-03-2027"]),
    "reservation voucher": (
        "RESERVATION_VOUCHER",
        _ctx("RESERVATION_VOUCHER"),
        ["Reservation Confirmation", "RS-2027-000123", "Sample Hill Resort", "10-01-2027"],
    ),
    "cancellation letter": (
        "CANCELLATION_LETTER",
        _ctx("CANCELLATION_LETTER"),
        ["Reservation Cancellation", "RS-2027-000123", "Nights credited back", "Change of plans"],
    ),
}


def _read(pdf_bytes: bytes) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    images = sum(len(page.images) for page in reader.pages)
    return " ".join(text.split()), images


@pytest.mark.parametrize("name", DOCUMENTS)
def test_each_document_renders_with_logo_rupee_and_labels(name: str) -> None:
    code, ctx, expected = DOCUMENTS[name]
    data = pdf.html_to_pdf(letters.compose(letters.DEFAULT_TEMPLATES[code], code, ctx))
    assert data.startswith(b"%PDF-")
    text, images = _read(data)
    assert images >= 1, "the brand logo must be embedded"
    assert pdf.STUB_MARK not in text and "Rs." not in text
    assert "Example Leisure LLP, promoter of Example Holidays" in text
    for snippet in expected:
        assert snippet in text, f"{snippet!r} missing from the {name} PDF"
    for raw in ("DOWN_PAYMENT", "MEMBERSHIP_EMI", "ASF_", "BOOKING_FEE"):
        assert raw not in text, f"raw code {raw!r} in the {name} PDF"


def test_other_currencies_are_shown_by_code_never_as_rupees() -> None:
    ctx = _ctx(
        "RECEIPT",
        p=sample_payment(currency="USD", base_amount=Decimal("2550"), total_amount=Decimal("2550")),
        m=SimpleNamespace(**vars(SAMPLE_MEMBER) | {"currency": "USD"}),
        method="Bank Transfer",
    )
    text, _ = _read(pdf.html_to_pdf(letters.compose(letters.DEFAULT_TEMPLATES["RECEIPT"], "RECEIPT", ctx)))
    assert "USD 2,550.00" in text and "₹" not in text
