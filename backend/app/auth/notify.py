"""Security notification emails to the account's registered address (never containing a password or link)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.context import get_context
from app.email import dispatch


def security_notice(session: AsyncSession, user: User, what: str, note: str | None = None) -> None:
    """E.g. what="Your password was changed". Sent after the transaction commits; skipped without an email."""
    if not user.email:
        return
    dispatch.queue(
        session,
        to=user.email,
        template="security_notice",
        subject=f"{what} - Club8 CRM",
        context={
            "name": user.full_name,
            "username": user.username,
            "what": what,
            "note": note,
            "when": dispatch.now_text(),
            "ip": get_context().ip,
        },
        user_id=str(user.id),
        username=user.username,
        kind="SECURITY_NOTICE",
    )
