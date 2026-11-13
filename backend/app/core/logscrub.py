"""Scrub secrets from every log record before any handler (console, Application Insights exporter) sees it.

Installed on logging.Logger.makeRecord, so it covers our loggers, uvicorn, SQLAlchemy and the Azure Monitor log
exporter alike. It is a safety net: code must still never log a password or token in the first place.
"""

from __future__ import annotations

import logging
import re
from typing import Any

REDACTED = "[REDACTED]"
_PATTERNS = [
    # Authorization: Bearer <token>  (before the generic rule, which would otherwise consume the word Bearer)
    re.compile(r"(?P<k>\bBearer\s+)(?P<v>[A-Za-z0-9._~+/-]+=*)", re.IGNORECASE),
    # "password": "...", 'new_password'='...', current_password=..., token=..., totp_code: 123456
    re.compile(
        r"""(?P<k>["']?\b[\w-]*(?:password|passwd|pwd|secret|token|totp_code|authorization)\b["']?\s*[:=]\s*)"""
        r"""(?P<v>"[^"]*"|'[^']*'|(?!\[REDACTED\])[^\s,;&}]+)""",
        re.IGNORECASE,
    ),
    # JWTs anywhere (three base64url segments starting with the encoded '{"')
    re.compile(r"(?P<k>)(?P<v>\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"),
    # cookies carrying our session tokens
    re.compile(r"(?P<k>\bcrm_(?:access|refresh|csrf)=)(?P<v>[^;\s]+)"),
]


def scrub(text: str) -> str:
    for p in _PATTERNS:
        text = p.sub(lambda m: m.group("k") + REDACTED, text)
    return text


def _scrub_value(v: Any) -> Any:
    if isinstance(v, str):
        return scrub(v)
    if isinstance(v, dict):
        return {k: (REDACTED if _sensitive_key(k) else _scrub_value(x)) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return type(v)(_scrub_value(x) for x in v)
    return v


def _sensitive_key(k: Any) -> bool:
    return isinstance(k, str) and bool(re.search(r"password|passwd|secret|token|totp_code|authorization", k, re.I))


_installed = False


def _scrub_record(record: logging.LogRecord) -> None:
    # Scrub the arguments in place, keeping their shape: some formatters (uvicorn's access log) unpack them.
    if isinstance(record.args, tuple):
        record.args = tuple(_scrub_value(a) for a in record.args)
    elif isinstance(record.args, dict):
        record.args = _scrub_value(record.args)
    if isinstance(record.msg, str):
        record.msg = scrub(record.msg)
    try:
        # A secret split between the format string and an argument ("password=%s", secret) only shows once
        # rendered: then keep the scrubbed rendering instead.
        rendered = record.getMessage()
        clean = scrub(rendered)
        if clean != rendered:
            record.msg, record.args = clean, None
    except Exception:
        record.msg, record.args = scrub(str(record.msg)), None
    for attr in ("exc_text", "stack_info"):
        if getattr(record, attr, None):
            setattr(record, attr, scrub(getattr(record, attr)))
    for k, v in list(record.__dict__.items()):
        if k not in _STANDARD and isinstance(v, (str, dict, list, tuple)):  # structured "extra" fields
            setattr(record, k, REDACTED if _sensitive_key(k) else _scrub_value(v))


def install() -> None:
    """Wrap Logger.makeRecord (class-wide, so every existing and future logger is covered). It runs after the
    `extra=` fields are attached, which a LogRecord factory would not see."""
    global _installed
    if _installed:
        return
    original = logging.Logger.makeRecord

    def make_record(self: logging.Logger, *args: Any, **kwargs: Any) -> logging.LogRecord:
        record = original(self, *args, **kwargs)
        _scrub_record(record)
        return record

    logging.Logger.makeRecord = make_record  # type: ignore[method-assign]
    _installed = True


_STANDARD = set(vars(logging.LogRecord("x", logging.INFO, "x", 0, "x", None, None))) | {"message", "asctime"}
