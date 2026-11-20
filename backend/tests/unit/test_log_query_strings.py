"""Query strings never reach a log or telemetry: they can carry personal data (member search ?q=<name or phone>) or,
from an old cached sign-in form submitted as GET, a password."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from uvicorn.logging import AccessFormatter

from app.core.logscrub import install, scrub, strip_query
from app.core.telemetry import QueryStringScrubber, instrument_fastapi

# Fictitious values only
NAME, PHONE, PASSWORD = "Rohan Fictitious", "9000000001", "Old-Cached-Form-1"


def test_strip_query():
    assert strip_query("/api/v1/members?q=Rohan") == "/api/v1/members?[REDACTED]"
    assert strip_query("/api/v1/members") == "/api/v1/members"


def test_uvicorn_access_log_has_no_query_and_keeps_its_shape(caplog):
    install()
    access = logging.getLogger("uvicorn.access")
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        access.info(
            '%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", f"/login?username=demo&password={PASSWORD}", "1.1", 200
        )
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", f"/api/v1/members?q={PHONE}", "1.1", 200)
    for rec in caplog.records[-2:]:
        line = AccessFormatter(fmt="%(client_addr)s - %(request_line)s %(status_code)s", use_colors=False).format(rec)
        assert PASSWORD not in line and PHONE not in line and "?[REDACTED]" in line
        assert len(rec.args) == 5  # uvicorn's formatter unpacks the arguments
    assert "GET /api/v1/members?[REDACTED] HTTP/1.1" in line


def test_request_lines_in_other_logs_lose_their_query():
    httpx_line = f'HTTP Request: GET https://sms.example.test/send?to={PHONE}&name=Rohan "HTTP/1.1 200 OK"'
    assert PHONE not in scrub(httpx_line)
    assert "GET https://sms.example.test/send?[REDACTED]" in scrub(httpx_line)
    assert scrub("no request here?x=1") == "no request here?x=1"


def test_dependency_span_url_loses_its_query():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(QueryStringScrubber())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    with provider.get_tracer("t").start_as_current_span(
        "GET", attributes={"http.url": f"https://sms.example.test/send?to={PHONE}", "url.query": f"to={PHONE}"}
    ):
        pass
    attrs = dict(exporter.get_finished_spans()[0].attributes or {})
    assert attrs["http.url"] == "https://sms.example.test/send?[REDACTED]" and attrs["url.query"] == "[REDACTED]"


def test_telemetry_spans_have_no_query():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(QueryStringScrubber())  # first, as configure_azure_monitor adds it before exporters
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    app = FastAPI()

    @app.get("/api/v1/members")
    def members() -> dict[str, str]:
        return {}

    instrument_fastapi(app, tracer_provider=provider)  # what setup_telemetry uses
    try:
        TestClient(app).get("/api/v1/members", params={"q": NAME})
    finally:
        FastAPIInstrumentor.uninstrument_app(app)
    spans = exporter.get_finished_spans()
    assert spans
    for span in spans:
        for value in (span.attributes or {}).values():
            assert "Rohan" not in str(value) and "Fictitious" not in str(value)
    server = next(s for s in spans if (s.attributes or {}).get("http.target") or (s.attributes or {}).get("url.path"))
    assert "q=" not in str(dict(server.attributes or {}))
