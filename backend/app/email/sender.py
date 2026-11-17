"""EmailSender interface and implementations (docs/PASSWORD_PROMPT.md Section 7).

* SmtpSender   - Mailpit locally / in CI (plain SMTP, no auth), or any relay.
* AcsSender    - Azure Communication Services Email, authenticated with the app's managed identity
                 (DefaultAzureCredential); only the endpoint is configured (from Key Vault).
* MemorySender - tests: keeps messages in OUTBOX.
* NullSender   - drops messages (and says so in the log).
Never log a message body: reset emails contain a single-use link.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from email.utils import formataddr, parseaddr
from typing import Protocol

from app.core.config import get_settings

log = logging.getLogger("crm.email")


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    html: str
    text: str


class EmailSender(Protocol):
    async def send(self, msg: EmailMessage) -> None: ...


class SmtpSender:
    def __init__(self, host: str, port: int, sender: str) -> None:
        self.host, self.port, self.sender = host, port, sender

    def _send(self, msg: EmailMessage) -> None:
        m = MimeMessage()
        name, addr = parseaddr(self.sender)
        m["From"] = formataddr((name, addr))
        m["To"] = msg.to
        m["Subject"] = msg.subject
        m.set_content(msg.text)
        m.add_alternative(msg.html, subtype="html")
        with smtplib.SMTP(self.host, self.port, timeout=10) as s:
            s.send_message(m)

    async def send(self, msg: EmailMessage) -> None:
        await asyncio.to_thread(self._send, msg)


class AcsSender:  # pragma: no cover - needs Azure; exercised in the dev environment
    def __init__(self, endpoint: str, sender: str) -> None:
        self.endpoint = endpoint
        self.sender = parseaddr(sender)[1]

    async def send(self, msg: EmailMessage) -> None:
        from azure.communication.email.aio import EmailClient
        from azure.identity.aio import DefaultAzureCredential

        async with DefaultAzureCredential() as cred, EmailClient(self.endpoint, cred) as client:
            poller = await client.begin_send(
                {
                    "senderAddress": self.sender,
                    "recipients": {"to": [{"address": msg.to}]},
                    "content": {"subject": msg.subject, "plainText": msg.text, "html": msg.html},
                }
            )
            result = await poller.result()
            if (result or {}).get("status") not in ("Succeeded", None):
                raise RuntimeError(f"ACS email status {result.get('status')}")


OUTBOX: list[EmailMessage] = []


class MemorySender:
    async def send(self, msg: EmailMessage) -> None:
        OUTBOX.append(msg)


class NullSender:
    async def send(self, msg: EmailMessage) -> None:
        log.warning("Email provider is 'none': message not sent (subject: %s)", msg.subject)


def get_sender() -> EmailSender:
    s = get_settings()
    if s.email_provider == "smtp":
        return SmtpSender(s.smtp_host, s.smtp_port, s.email_from)
    if s.email_provider == "acs":
        if not s.acs_endpoint:
            raise RuntimeError("CRM_ACS_ENDPOINT is required for the acs email provider")
        return AcsSender(s.acs_endpoint, s.email_from)
    if s.email_provider == "memory":
        return MemorySender()
    return NullSender()
