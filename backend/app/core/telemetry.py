"""OpenTelemetry -> Azure Monitor / Application Insights."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from opentelemetry.sdk.trace import SpanProcessor

from app.core.logscrub import REDACTED, strip_query

# Span attributes that carry a URL or its query (old and stable HTTP semantic conventions). Query strings can hold
# personal data (member search ?q=<name or phone>), so they never reach Application Insights.
_URL_ATTRS = ("http.url", "url.full", "http.target")
_QUERY_ATTRS = ("url.query",)


def scrub_span_attributes(attributes: dict[str, Any] | Any) -> dict[str, str]:
    """The replacements for any URL attribute that has a query string; empty when there is nothing to change."""
    out: dict[str, str] = {}
    for key in _URL_ATTRS:
        v = attributes.get(key)
        if isinstance(v, str) and "?" in v:
            out[key] = strip_query(v)
    for key in _QUERY_ATTRS:
        if attributes.get(key):
            out[key] = REDACTED
    return out


def _scrub_span(span: Any) -> None:
    if span.is_recording():
        for k, v in scrub_span_attributes(getattr(span, "attributes", None) or {}).items():
            span.set_attribute(k, v)


class QueryStringScrubber(SpanProcessor):
    """Span processor for dependency spans (outgoing HTTP calls), which set their URL when the span is created."""

    def on_start(self, span: Any, parent_context: Any = None) -> None:
        _scrub_span(span)


def instrument_fastapi(app: FastAPI, tracer_provider: Any = None) -> None:
    """Request spans. The ASGI instrumentation sets the URL attributes again after the span has started, so a span
    processor's on_start is too early: the request hook runs after that."""
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="healthz,readyz",
        server_request_hook=lambda span, _scope: _scrub_span(span),
        tracer_provider=tracer_provider,
    )


def setup_telemetry(app: FastAPI, connection_string: str) -> None:  # pragma: no cover
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor(
        connection_string=connection_string,
        logger_name="crm",
        enable_live_metrics=True,
        span_processors=[QueryStringScrubber()],
        # request spans come only from instrument_fastapi below (with the query scrubbed), never a second copy
        instrumentation_options={"fastapi": {"enabled": False}},
    )
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

    from app.core.db import get_engine

    instrument_fastapi(app)
    SQLAlchemyInstrumentor().instrument(engine=get_engine().sync_engine)
