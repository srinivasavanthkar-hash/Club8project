"""The PDF engine never falls back to a plain-text document, and the test stub can never pass for a real one."""

import io

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.correspondence import pdf


def _boom() -> None:
    raise OSError("cannot load library 'libpango-1.0-0'")


def test_stub_pdf_carries_the_visible_test_mark_on_every_page(monkeypatch: pytest.MonkeyPatch) -> None:
    from pypdf import PdfReader

    monkeypatch.setattr(get_settings(), "pdf_engine", "test_stub")
    body = "".join(f"<p>Line {i}</p>" for i in range(120))  # several pages
    reader = PdfReader(io.BytesIO(pdf.html_to_pdf(f"<h1>Payment Receipt</h1>{body}")))
    assert len(reader.pages) > 1
    for page in reader.pages:
        assert pdf.STUB_MARK in (page.extract_text() or "")


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_the_stub_is_refused_in_staging_and_production(env: str) -> None:
    with pytest.raises(ValidationError, match="test_stub"):
        Settings(env=env, pdf_engine="test_stub", app_base_url="https://crm.example.test")


def test_a_broken_engine_fails_the_request_instead_of_writing_plain_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "pdf_engine", "weasyprint")
    monkeypatch.setattr(pdf, "_weasyprint_html", _boom)
    with pytest.raises(pdf.PdfEngineUnavailable, match="PDF engine unavailable") as e:
        pdf.html_to_pdf("<p>Receipt</p>")
    assert e.value.status == 503


async def test_health_check_reports_the_pdf_engine() -> None:
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "pdf_engine": "test_stub"}


def test_api_and_worker_refuse_to_start_without_the_engine(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(get_settings(), "pdf_engine", "weasyprint")
    monkeypatch.setattr(pdf, "_weasyprint_html", _boom)
    assert pdf.engine_status()[0] == "error"
    with pytest.raises(SystemExit, match="PDF engine unavailable"):
        pdf.require_engine("worker")
    assert "worker cannot start: the PDF engine is unavailable" in caplog.text
