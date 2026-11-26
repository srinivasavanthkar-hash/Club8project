"""Parse uploaded .eml (stdlib `email`) and .msg (extract-msg) files into a normalised structure."""

from __future__ import annotations

import email
import email.policy
import io
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import getaddresses, parsedate_to_datetime
from typing import Protocol

from app.core.timeutil import now_utc


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes


@dataclass
class ParsedEmail:
    sender: str
    to: list[str]
    cc: list[str]
    subject: str
    sent_at: datetime
    body_text: str
    body_html: str | None
    message_id: str | None
    in_reply_to: str | None
    references: list[str] = field(default_factory=list)
    attachments: list[ParsedAttachment] = field(default_factory=list)


def _addrs(values: list[str]) -> list[str]:
    return [a for _, a in getaddresses(values) if a]


def parse_eml(raw: bytes) -> ParsedEmail:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    try:
        sent = parsedate_to_datetime(msg["date"]) if msg["date"] else now_utc()
        if sent.tzinfo is None:
            sent = sent.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        sent = now_utc()
    text_part = msg.get_body(preferencelist=("plain",))
    html_part = msg.get_body(preferencelist=("html",))
    attachments = []
    for part in msg.iter_attachments():
        payload = part.get_payload(decode=True)
        data = payload if isinstance(payload, bytes) else b""
        attachments.append(ParsedAttachment(part.get_filename() or "attachment", part.get_content_type(), data))
    refs = (msg["references"] or "").split()
    return ParsedEmail(
        sender=(_addrs([msg["from"] or ""]) or [""])[0],
        to=_addrs(msg.get_all("to", [])),
        cc=_addrs(msg.get_all("cc", [])),
        subject=str(msg["subject"] or "(no subject)"),
        sent_at=sent,
        body_text=text_part.get_content() if text_part else "",
        body_html=html_part.get_content() if html_part else None,
        message_id=(msg["message-id"] or "").strip() or None,
        in_reply_to=(msg["in-reply-to"] or "").strip() or None,
        references=refs,
        attachments=attachments,
    )


def parse_msg(raw: bytes) -> ParsedEmail:  # pragma: no cover - needs a real .msg fixture
    import extract_msg

    m = extract_msg.Message(io.BytesIO(raw))  # type: ignore[no-untyped-call]
    try:
        sent = m.date if isinstance(m.date, datetime) else now_utc()
        headers = m.header
        return ParsedEmail(
            sender=(_addrs([m.sender or ""]) or [m.sender or ""])[0],
            to=_addrs([m.to or ""]),
            cc=_addrs([m.cc or ""]),
            subject=m.subject or "(no subject)",
            sent_at=sent if sent.tzinfo else sent.replace(tzinfo=UTC),
            body_text=m.body or "",
            body_html=(m.htmlBody.decode(errors="replace") if m.htmlBody else None),
            message_id=(headers.get("Message-ID") if headers else None),
            in_reply_to=(headers.get("In-Reply-To") if headers else None),
            attachments=[
                ParsedAttachment(
                    a.longFilename or a.shortFilename or "attachment",
                    "application/octet-stream",
                    a.data if isinstance(a.data, bytes) else b"",
                )
                for a in m.attachments
                if isinstance(getattr(a, "data", None), bytes)
            ],
        )
    finally:
        m.close()


class EmailIngestionPort(Protocol):
    """Extension point for mailbox sync (Microsoft 365 Graph / Google Workspace). NOT implemented in this scope.

    An implementation would poll or subscribe to a shared mailbox, map each message to a member by sender/recipient
    address, and call `correspondence.service.ingest_parsed(...)` with source="SYNC".
    """

    async def fetch_since(self, cursor: str | None) -> tuple[list[ParsedEmail], str]: ...
