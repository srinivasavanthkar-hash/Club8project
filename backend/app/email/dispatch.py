"""Queue emails with the database transaction; send them after it commits, in the background, with retries.

A failed or slow send never changes the API response the user sees, and nothing is sent if the transaction rolls
back. Outcomes are recorded in the activity log (EMAIL_SENT / EMAIL_FAILED, recipient masked). The rendered body is
never logged or stored: reset emails carry a single-use link.

Dispatch: `inline` (local, tests) runs an in-process task with retries; `worker` (Azure, docker) enqueues the
Dramatiq job `send_email`, which retries on failure. The job travels through Redis only until it is processed.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.timeutil import fmt_dt_ist
from app.email.sender import EmailMessage, get_sender

log = logging.getLogger("crm.email")
_PENDING = "pending_emails"
BACKOFF_SECONDS = 1.0  # inline retries: 1 s, 2 s
_TASKS: set[asyncio.Task[bool]] = set()
_env = Environment(
    loader=FileSystemLoader(str(__import__("pathlib").Path(__file__).parent / "templates")),
    autoescape=select_autoescape(["html"]),
    keep_trailing_newline=True,
)

BRANDS = {
    "club8": {"name": "Club8 Holidays", "primary": "#393186", "accent": "#EF7F1B", "logo": "club8/club8-logo.png"},
    "k8": {"name": "K8", "primary": "#172040", "accent": "#BC9C23", "logo": "k8/k8-logo.png"},
}


def mask_address(addr: str) -> str:
    local, _, domain = addr.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def render(template: str, subject: str, context: dict[str, Any]) -> tuple[str, str]:
    s = get_settings()
    b = BRANDS[s.default_brand]
    ctx = {
        **context,
        "subject": subject,
        "admin_contact": s.admin_contact,
        "brand": {**b, "logo_url": f"{s.app_base_url.rstrip('/')}/brand/{b['logo']}"},
    }
    return _env.get_template(f"{template}.html").render(ctx), _env.get_template(f"{template}.txt").render(ctx)


def queue(
    session: AsyncSession,
    *,
    to: str,
    template: str,
    subject: str,
    context: dict[str, Any],
    user_id: str,
    username: str,
    kind: str,
) -> None:
    """`kind` names the email in the activity log (e.g. RESET_LINK, PASSWORD_CHANGED)."""
    session.sync_session.info.setdefault(_PENDING, []).append(
        {
            "to": to,
            "template": template,
            "subject": subject,
            "context": context,
            "user_id": user_id,
            "username": username,
            "kind": kind,
        }
    )


def now_text() -> str:
    return fmt_dt_ist(datetime.now().astimezone())


async def _record(job: dict[str, Any], ok: bool, detail: str = "") -> None:
    from app.audit import service as audit
    from app.core.context import RequestContext, set_context
    from app.core.db import sessionmaker

    set_context(RequestContext(username="system:email"))
    async with sessionmaker()() as s:
        audit.record(
            s,
            "EMAIL_SENT" if ok else "EMAIL_FAILED",
            f"{job['kind'].replace('_', ' ').capitalize()} email {'sent' if ok else 'failed'} to "
            f"{mask_address(job['to'])}{(': ' + detail) if detail else ''}",
            entity_type="users",
            entity_id=job["user_id"],
            entity_ref=job["username"],
        )
        await s.commit()


async def deliver(job: dict[str, Any], attempts: int = 3, raise_on_failure: bool = False) -> bool:
    html, text = render(job["template"], job["subject"], job["context"])
    msg = EmailMessage(to=job["to"], subject=job["subject"], html=html, text=text)
    last = ""
    for attempt in range(1, attempts + 1):
        try:
            await get_sender().send(msg)
            await _record(job, True)
            return True
        except Exception as e:  # recorded; never raised into the request
            last = type(e).__name__
            log.warning("Email send failed (attempt %s/%s, %s)", attempt, attempts, last)
            if attempt < attempts:
                await asyncio.sleep(BACKOFF_SECONDS * 2 ** (attempt - 1))
    await _record(job, False, last)
    if raise_on_failure:
        raise RuntimeError(f"email delivery failed: {last}")
    return False


def _after_commit(session: Session) -> None:
    jobs: list[dict[str, Any]] = session.info.pop(_PENDING, [])
    if not jobs:
        return
    if get_settings().email_dispatch == "worker":
        from app.jobs.tasks import send_email

        for job in jobs:
            send_email.send(job)
        return
    loop = asyncio.get_running_loop()
    for job in jobs:
        task = loop.create_task(deliver(job))
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)


def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING, None)


def install() -> None:
    if not event.contains(Session, "after_commit", _after_commit):
        event.listen(Session, "after_commit", _after_commit)
        event.listen(Session, "after_soft_rollback", lambda s, _t: _after_rollback(s))


async def drain() -> None:
    """Tests: wait for inline sends to finish."""
    while _TASKS:
        await asyncio.gather(*list(_TASKS), return_exceptions=True)
