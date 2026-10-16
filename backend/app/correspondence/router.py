import uuid
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.admin.models import Company, Property
from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.errors import RuleViolation
from app.core.repository import get_or_404
from app.core.timeutil import today_ist
from app.core.validators import normalize_phone
from app.correspondence import documents, letters, service
from app.correspondence.emailparse import ParsedEmail
from app.correspondence.models import Call, Document, DocumentLink, Email, EmailThread
from app.members.models import Member
from app.reservations.models import Reservation

router = APIRouter(route_class=TransactionalRoute, tags=["correspondence"])


# ---------------------------------------------------------------- emails
class EmailIn(BaseModel):
    direction: Literal["INCOMING", "OUTGOING"]
    sent_at: datetime
    sender: EmailStr
    to: list[EmailStr] = Field(min_length=1)
    cc: list[EmailStr] = []
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(max_length=200_000)
    thread_id: uuid.UUID | None = None
    reservation_id: uuid.UUID | None = None


def _email_out(e: Email) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "thread_id": str(e.thread_id),
        "direction": e.direction,
        "sent_at": e.sent_at,
        "sender": e.sender,
        "to": [r.address for r in e.recipients if r.kind == "TO"],
        "cc": [r.address for r in e.recipients if r.kind == "CC"],
        "subject": e.subject,
        "body_text": e.body_text,
        "message_id": e.message_id,
        "reservation_id": str(e.reservation_id) if e.reservation_id else None,
        "source": e.source,
    }


@router.post("/members/{member_id}/emails", status_code=201)
async def add_email(
    member_id: uuid.UUID,
    body: EmailIn,
    session: SessionDep,
    user: User = Depends(require_permission("correspondence.create")),
) -> dict[str, Any]:
    p = ParsedEmail(
        sender=body.sender,
        to=list(body.to),
        cc=list(body.cc),
        subject=body.subject,
        sent_at=body.sent_at,
        body_text=body.body,
        body_html=None,
        message_id=None,
        in_reply_to=None,
    )
    e = await service.add_email(
        session,
        member_id,
        p,
        direction=body.direction,
        user=user,
        source="MANUAL",
        thread_id=body.thread_id,
        reservation_id=body.reservation_id,
    )
    return _email_out(e)


@router.post("/members/{member_id}/emails/import", status_code=201)
async def import_email(
    member_id: uuid.UUID,
    session: SessionDep,
    file: UploadFile = File(...),
    direction: Literal["INCOMING", "OUTGOING"] = Form(...),
    reservation_id: uuid.UUID | None = Form(None),
    thread_id: uuid.UUID | None = Form(None),
    user: User = Depends(require_permission("correspondence.create")),
) -> dict[str, Any]:
    raw = await file.read(25 * 1024 * 1024 + 1)
    if len(raw) > 25 * 1024 * 1024:
        raise RuleViolation("Email file too large", code="FileTooLarge")
    e = await service.upload_email_file(
        session, member_id, file.filename or "", raw, direction, user, reservation_id, thread_id
    )
    return _email_out(e)


@router.get("/members/{member_id}/email-threads")
async def threads(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("correspondence.view"))
) -> list[dict[str, Any]]:
    ts = (await session.execute(select(EmailThread).where(EmailThread.member_id == member_id))).scalars().all()
    es = (
        (
            await session.execute(
                select(Email).where(Email.member_id == member_id, Email.deleted_at.is_(None)).order_by(Email.sent_at)
            )
        )
        .scalars()
        .all()
    )
    by_thread: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for e in es:
        by_thread.setdefault(e.thread_id, []).append(_email_out(e))
    return sorted(
        [
            {
                "id": str(t.id),
                "subject": t.subject,
                "reservation_id": str(t.reservation_id) if t.reservation_id else None,
                "emails": by_thread.get(t.id, []),
            }
            for t in ts
        ],
        key=lambda t: t["emails"][-1]["sent_at"].isoformat() if t["emails"] else "",
        reverse=True,
    )


class MoveIn(BaseModel):
    thread_id: uuid.UUID


@router.post("/emails/{email_id}/thread")
async def add_to_thread(
    email_id: uuid.UUID,
    body: MoveIn,
    session: SessionDep,
    user: User = Depends(require_permission("correspondence.create")),
) -> dict[str, Any]:
    e = await get_or_404(session, Email, email_id, label="Email")
    t = await get_or_404(session, EmailThread, body.thread_id, label="Thread")
    if t.member_id != e.member_id:
        raise RuleViolation("Thread belongs to another member", code="ThreadMember")
    e.thread_id = t.id
    e.updated_by = user.id
    return _email_out(e)


# ---------------------------------------------------------------- calls
class CallIn(BaseModel):
    direction: Literal["INCOMING", "OUTGOING"]
    called_at: datetime
    staff_id: uuid.UUID | None = None
    contact_number: str = Field(min_length=4, max_length=20)
    summary: str = Field(min_length=1, max_length=4000)
    outcome_id: uuid.UUID | None = None
    next_action: str | None = Field(None, max_length=300)
    next_action_date: date | None = None
    reservation_id: uuid.UUID | None = None
    recording_document_id: uuid.UUID | None = None


def _call_out(c: Call) -> dict[str, Any]:
    return {
        k: (str(v) if isinstance(v, uuid.UUID) else v)
        for k, v in {
            "id": c.id,
            "direction": c.direction,
            "called_at": c.called_at,
            "staff_id": c.staff_id,
            "contact_number": c.contact_number,
            "summary": c.summary,
            "outcome_id": c.outcome_id,
            "next_action": c.next_action,
            "next_action_date": c.next_action_date,
            "next_action_done": c.next_action_done,
            "reservation_id": c.reservation_id,
            "recording_document_id": c.recording_document_id,
        }.items()
    }


@router.post("/members/{member_id}/calls", status_code=201)
async def add_call(
    member_id: uuid.UUID,
    body: CallIn,
    session: SessionDep,
    user: User = Depends(require_permission("correspondence.create")),
) -> dict[str, Any]:
    data = body.model_dump()
    data["contact_number"] = normalize_phone(body.contact_number) or body.contact_number
    return _call_out(await service.add_call(session, member_id, data, user))


@router.get("/members/{member_id}/calls")
async def list_calls(
    member_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("correspondence.view"))
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(Call).where(Call.member_id == member_id, Call.deleted_at.is_(None)).order_by(Call.called_at.desc())
        )
    ).scalars()
    return [_call_out(c) for c in rows]


@router.get("/calls/follow-ups")
async def call_follow_ups(
    session: SessionDep, _: User = Depends(require_permission("correspondence.view")), staff_id: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    return [_call_out(c) for c in await service.follow_up_calls(session, today_ist(), staff_id)]


@router.post("/calls/{call_id}/done")
async def call_done(
    call_id: uuid.UUID, session: SessionDep, user: User = Depends(require_permission("correspondence.create"))
) -> dict[str, Any]:
    c = await get_or_404(session, Call, call_id, label="Call")
    c.next_action_done = True
    c.updated_by = user.id
    return _call_out(c)


# ---------------------------------------------------------------- documents
def _doc_out(d: Document) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "member_id": str(d.member_id) if d.member_id else None,
        "document_type_id": str(d.document_type_id),
        "description": d.description,
        "file_name": d.file_name,
        "content_type": d.content_type,
        "size_bytes": d.size_bytes,
        "scan_status": d.scan_status,
        "is_generated": d.is_generated,
        "created_at": d.created_at,
        "created_by": str(d.created_by) if d.created_by else None,
        "links": [{"entity_type": lk.entity_type, "entity_id": str(lk.entity_id)} for lk in d.links],
    }


@router.post("/members/{member_id}/documents", status_code=201)
async def upload(
    member_id: uuid.UUID,
    session: SessionDep,
    file: UploadFile = File(...),
    document_type_id: uuid.UUID = Form(...),
    description: str | None = Form(None),
    link_type: str | None = Form(None),
    link_id: uuid.UUID | None = Form(None),
    user: User = Depends(require_permission("document.upload")),
) -> dict[str, Any]:
    await get_or_404(session, Member, member_id, label="Member")
    data = await file.read(100 * 1024 * 1024 + 1)
    links = [(link_type, link_id)] if link_type and link_id else []
    d = await documents.store(
        session,
        data=data,
        file_name=file.filename or "upload",
        document_type_id=document_type_id,
        member_id=member_id,
        user=user,
        description=description,
        links=links,
    )
    return _doc_out(d)


@router.get("/members/{member_id}/documents")
async def list_documents(
    member_id: uuid.UUID,
    session: SessionDep,
    _: User = Depends(require_permission("document.view")),
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    q = select(Document).where(Document.member_id == member_id, Document.deleted_at.is_(None))
    if entity_type and entity_id:
        q = q.where(
            Document.id.in_(
                select(DocumentLink.document_id).where(
                    DocumentLink.entity_type == entity_type, DocumentLink.entity_id == entity_id
                )
            )
        )
    return [_doc_out(d) for d in (await session.execute(q.order_by(Document.created_at.desc()))).scalars()]


@router.get("/documents/{doc_id}/url")
async def document_url(
    doc_id: uuid.UUID,
    session: SessionDep,
    inline: bool = True,
    user: User = Depends(require_permission("document.view")),
) -> dict[str, Any]:
    """Short-lived read-only SAS URL (inline preview or attachment download), issued after a permission check."""
    return await documents.signed_url(session, doc_id, user, inline)


class DeleteIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/documents/{doc_id}/delete")
async def delete_document(
    doc_id: uuid.UUID, body: DeleteIn, session: SessionDep, user: User = Depends(require_permission("document.delete"))
) -> dict[str, Any]:
    return _doc_out(await documents.soft_delete(session, doc_id, body.reason, user))


# ---------------------------------------------------------------- letters
@router.post("/reservations/{reservation_id}/voucher", status_code=201)
async def voucher(
    reservation_id: uuid.UUID, session: SessionDep, user: User = Depends(require_permission("letter.generate"))
) -> dict[str, Any]:
    r = await get_or_404(session, Reservation, reservation_id, label="Reservation")
    if r.status != "CONFIRMED":
        raise RuleViolation("Vouchers are generated for confirmed reservations", code="NotConfirmed")
    m = await get_or_404(session, Member, r.member_id, label="Member")
    prop = await session.get(Property, r.property_id)
    company = await session.get(Company, m.company_id)
    d = await letters.generate(
        session,
        code="RESERVATION_VOUCHER",
        doc_type_code="VOUCHER",
        ctx={
            "company": company,
            "m": m,
            "r": r,
            "property": prop.name if prop else "",
            "name": m.applicants[0].full_name if m.applicants else "",
        },
        member_id=m.id,
        file_name=f"voucher-{r.reservation_number}.pdf",
        user=user,
        links=[("RESERVATION", r.id)],
    )
    return _doc_out(d)


# ---------------------------------------------------------------- timeline
@router.get("/members/{member_id}/timeline")
async def timeline(
    member_id: uuid.UUID,
    session: SessionDep,
    _: User = Depends(require_permission("member.view")),
    types: list[str] | None = Query(None),
) -> list[dict[str, Any]]:
    return await service.timeline(session, member_id, set(types) if types else None)
