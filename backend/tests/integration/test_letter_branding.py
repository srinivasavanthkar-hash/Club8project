"""Receipts carry the logo and legal name of the member's company (docs/BRAND_PROMPT.md section 5).
Fictitious members only; the HTML handed to the PDF renderer is inspected."""

from typing import Any

import pytest

from app.correspondence import letters
from app.demo_scenario import master

from .helpers import member_payload, ok


async def test_receipts_use_the_record_company_logo_and_legal_name(api: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    rendered: list[str] = []
    real = letters.html_to_pdf

    def capture(html_doc: str) -> bytes:
        rendered.append(html_doc)
        return real(html_doc)

    monkeypatch.setattr(letters, "html_to_pdf", capture)
    await api.login("demo.sales")
    k8 = await master(api, "companies", "K8")

    ok(await api.post("/api/v1/members", json=await member_payload(api)), 201)  # Club8 (default company)
    club8_html = [h for h in rendered if "letter-receipt" in h]
    assert club8_html, "the Club8 down payment should generate a receipt"
    assert 'data-logo="club8/club8-logo.png"' in club8_html[-1]
    assert "Multiple Sales and Marketing LLP, promoter of CLUB8 Holidays" in club8_html[-1]

    rendered.clear()
    ok(await api.post("/api/v1/members", json=await member_payload(api, company_id=k8["id"])), 201)
    k8_html = [h for h in rendered if "letter-receipt" in h]
    assert k8_html, "the K8 down payment should generate a receipt"
    assert 'data-logo="k8/k8-logo.png"' in k8_html[-1]
    assert "Klub Eight Asia Ventures" in k8_html[-1]
    assert "Multiple Sales and Marketing" not in k8_html[-1]
    assert "#172040" in k8_html[-1] and "#393186" not in k8_html[-1]
