"""Emails, calls and the unified member timeline."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.models import ActivityLog
from app.auth.models import User
from app.core.errors import RuleViolation
from app.core.repository import get_or_404
from app.correspondence import documents
from app.correspondence.emailparse import ParsedEmail, parse_eml, parse_msg
from app.correspondence.models import Call, Document, Email, EmailRecipient, EmailThread
from app.entitlement.models import EntitlementLedger
from app.finance.models import Payment
from app.members.models import Member, MemberStatusHistory
from app.reservations.models import Reservation, ReservationStatusHistory


async def _thread_for(
    session: AsyncSession,
    member_id: uuid.UUID,
    parsed_subject: str,
    in_reply_to: str | None,
    references: list[str],
    explicit_thread: uuid.UUID | None,
    reservation_id: uuid.UUID | None,
) -> EmailThread:
    if explicit_thread:
        t = await get_or_404(session, EmailThread, explicit_thread, label="Thread")
        if t.member_id != member_id:
            raise RuleViolation("Thread belongs to another member", code="ThreadMember")
        return t
    ids = [x for x in [in_reply_to, *references] if x]
    if ids:
        e = (
            await session.execute(select(Email).where(Email.member_id == member_id, Email.message_id.in_(ids)).limit(1))
        ).scalar_one_or_none()
        if e:
            return await get_or_404(session, EmailThread, e.thread_id, label="Thread")
    t = EmailThread(member_id=member_id, subject=parsed_subject[:500], reservation_id=reservation_id)
    session.add(t)
    await session.flush()
    return t


async def add_email(
    session: AsyncSession,
    member_id: uuid.UUID,
    p: ParsedEmail,
    *,
    direction: str,
    user: User,
    source: str,
    thread_id: uuid.UUID | None,
    reservation_id: uuid.UUID | None,
    source_document_id: uuid.UUID | None = None,
) -> Email:
    member = await get_or_404(session, Member, member_id, label="Member")
    if reservation_id:
        r = await get_or_404(session, Reservation, reservation_id, label="Reservation")
        if r.member_id != member.id:
            raise RuleViolation("Reservation belongs to another member", code="ReservationMember")
    if p.message_id:
        dup = (
            await session.execute(
                select(Email.id).where(Email.member_id == member.id, Email.message_id == p.message_id)
            )
        ).first()
        if dup:
            raise RuleViolation("This email (Message-ID) is already recorded for the member", code="DuplicateEmail")
    thread = await _thread_for(session, member.id, p.subject, p.in_reply_to, p.references, thread_id, reservation_id)
    e = Email(
        member_id=member.id,
        thread_id=thread.id,
        reservation_id=reservation_id,
        direction=direction,
        sent_at=p.sent_at,
        sender=p.sender,
        subject=p.subject[:500],
        body_text=p.body_text,
        body_html=p.body_html,
        message_id=p.message_id,
        in_reply_to=p.in_reply_to,
        source=source,
        source_document_id=source_document_id,
        created_by=user.id,
    )
    session.add(e)
    await session.flush()
    for kind, addrs in (("TO", p.to), ("CC", p.cc)):
        for a in addrs:
            session.add(EmailRecipient(email_id=e.id, kind=kind, address=a[:320]))
    other = await documents.doc_type(session, "OTHER")
    for att in p.attachments:
        try:
            await documents.store(
                session,
                data=att.data,
                file_name=att.filename,
                document_type_id=other.id,
                member_id=member.id,
                user=user,
                description=f"Attachment of email: {p.subject[:100]}",
                links=[("EMAIL", e.id)] + ([("RESERVATION", reservation_id)] if reservation_id else []),
            )
        except RuleViolation as ex:
            audit.record(
                session,
                "ATTACHMENT_SKIPPED",
                f"Attachment {att.filename} skipped: {ex.detail}",
                entity_type="emails",
                entity_id=e.id,
                member_id=member.id,
            )
    await session.flush()
    await session.refresh(e, ["recipients"])
    return e


async def upload_email_file(
    session: AsyncSession,
    member_id: uuid.UUID,
    filename: str,
    raw: bytes,
    direction: str,
    user: User,
    reservation_id: uuid.UUID | None,
    thread_id: uuid.UUID | None,
) -> Email:
    lower = filename.lower()
    if lower.endswith(".eml"):
        parsed, src = parse_eml(raw), "EML"
    elif lower.endswith(".msg"):
        parsed, src = parse_msg(raw), "MSG"
    else:
        raise RuleViolation("Only .eml or .msg files can be imported", code="EmailFileType")
    return await add_email(
        session,
        member_id,
        parsed,
        direction=direction,
        user=user,
        source=src,
        thread_id=thread_id,
        reservation_id=reservation_id,
    )


async def add_call(session: AsyncSession, member_id: uuid.UUID, data: dict[str, Any], user: User) -> Call:
    member = await get_or_404(session, Member, member_id, label="Member")
    c = Call(
        member_id=member.id,
        staff_id=data.get("staff_id") or user.id,
        created_by=user.id,
        **{k: v for k, v in data.items() if k != "staff_id"},
    )
    session.add(c)
    await session.flush()
    return c


async def follow_up_calls(session: AsyncSession, until: date, staff_id: uuid.UUID | None) -> list[Call]:
    q = select(Call).where(Call.deleted_at.is_(None), Call.next_action_done.is_(False), Call.next_action_date <= until)
    if staff_id:
        q = q.where(Call.staff_id == staff_id)
    return list((await session.execute(q.order_by(Call.next_action_date))).scalars())


TIMELINE_TYPES = {"email", "call", "document", "payment", "reservation", "entitlement", "status"}


async def timeline(
    session: AsyncSession, member_id: uuid.UUID, types: set[str] | None, limit: int = 300
) -> list[dict[str, Any]]:
    types = types or TIMELINE_TYPES
    items: list[dict[str, Any]] = []

    def add(kind: str, at: datetime | date, title: str, ref: dict[str, Any]) -> None:
        items.append(
            {
                "type": kind,
                "at": at if isinstance(at, datetime) else datetime(at.year, at.month, at.day, tzinfo=UTC),
                "title": title,
                **ref,
            }
        )

    if "email" in types:
        for e in (
            await session.execute(select(Email).where(Email.member_id == member_id, Email.deleted_at.is_(None)))
        ).scalars():
            add(
                "email",
                e.sent_at,
                f"{'⬅' if e.direction == 'INCOMING' else '➡'} {e.subject}",
                {"id": str(e.id), "thread_id": str(e.thread_id)},
            )
    if "call" in types:
        for c in (
            await session.execute(select(Call).where(Call.member_id == member_id, Call.deleted_at.is_(None)))
        ).scalars():
            add("call", c.called_at, f"{c.direction.title()} call: {c.summary[:120]}", {"id": str(c.id)})
    if "document" in types:
        for d in (
            await session.execute(
                select(Document).where(Document.member_id == member_id, Document.deleted_at.is_(None))
            )
        ).scalars():
            add("document", d.created_at, f"Document {d.file_name}", {"id": str(d.id)})
    if "payment" in types:
        for p in (await session.execute(select(Payment).where(Payment.member_id == member_id))).scalars():
            add(
                "payment",
                p.created_at,
                f"{p.entry_kind.title()} {p.payment_type_code} {p.total_amount} {p.currency} ({p.receipt_number})",
                {"id": str(p.id)},
            )
    if "reservation" in types:
        rows = (
            await session.execute(
                select(ReservationStatusHistory, Reservation.reservation_number)
                .join(Reservation, Reservation.id == ReservationStatusHistory.reservation_id)
                .where(Reservation.member_id == member_id)
            )
        ).all()
        for h, num in rows:
            add(
                "reservation",
                h.changed_at,
                f"Reservation {num}: {h.from_status or 'new'} → {h.to_status}",
                {"id": str(h.reservation_id)},
            )
    if "entitlement" in types:
        for le in (
            await session.execute(
                select(EntitlementLedger).where(
                    EntitlementLedger.member_id == member_id, EntitlementLedger.entry_type != "ALLOCATION"
                )
            )
        ).scalars():
            add(
                "entitlement",
                le.created_at,
                f"{le.entry_type} {le.delta} night(s) [{le.origin_year}]",
                {"id": str(le.id)},
            )
    if "status" in types:
        for s in (
            await session.execute(select(MemberStatusHistory).where(MemberStatusHistory.member_id == member_id))
        ).scalars():
            add("status", s.changed_at, f"Member status {s.from_status or 'new'} → {s.to_status}", {"id": str(s.id)})
    items.sort(key=lambda i: i["at"], reverse=True)
    return items[:limit]


async def activity_for_member(session: AsyncSession, member_id: uuid.UUID) -> list[ActivityLog]:
    return list(
        (
            await session.execute(
                select(ActivityLog).where(ActivityLog.member_id == member_id).order_by(ActivityLog.seq)
            )
        ).scalars()
    )
