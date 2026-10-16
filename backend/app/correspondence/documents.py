"""Document store service: validate, scan, store, link, signed URLs, soft delete."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import DocumentType
from app.audit import service as audit
from app.auth.models import User
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.core.settings_store import get_setting
from app.correspondence.models import Document, DocumentLink
from app.storage.blob import get_blob_store
from app.storage.filetype import validate_upload
from app.storage.scan import get_scanner

LINK_TYPES = {"MEMBER", "APPLICANT", "PAYMENT", "RESERVATION", "EMAIL", "CALL", "LEAD"}


async def doc_type(session: AsyncSession, code: str) -> DocumentType:
    dt = (await session.execute(select(DocumentType).where(DocumentType.code == code))).scalar_one_or_none()
    if dt is None:
        raise RuleViolation(f"Unknown document type {code}", code="UnknownDocumentType")
    return dt


async def store(
    session: AsyncSession,
    *,
    data: bytes,
    file_name: str,
    document_type_id: uuid.UUID,
    member_id: uuid.UUID | None,
    user: User | None,
    description: str | None = None,
    links: list[tuple[str, uuid.UUID]] | None = None,
    generated: bool = False,
) -> Document:
    allowed = await get_setting(session, "documents.allowed_types")
    max_mb = int(await get_setting(session, "documents.max_upload_mb"))
    mime = validate_upload(data, allowed, max_mb)
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._- ")[:200] or "document"
    doc_id = uuid.uuid4()
    path = f"{member_id or 'unlinked'}/{doc_id}/{safe_name}"
    status = "CLEAN" if generated else await get_scanner().scan(data) or "PENDING"
    if status == "INFECTED":
        audit.record(session, "UPLOAD_REJECTED", f"Upload {safe_name} rejected: malware detected", member_id=member_id)
        raise RuleViolation("The file failed the virus scan and was rejected", code="Infected")
    await get_blob_store().put(path, data, mime)
    doc = Document(
        id=doc_id,
        member_id=member_id,
        document_type_id=document_type_id,
        description=description,
        file_name=safe_name,
        content_type=mime,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        blob_path=path,
        scan_status=status,
        is_generated=generated,
        created_by=user.id if user else None,
    )
    session.add(doc)
    await session.flush()
    for etype, eid in [("MEMBER", member_id)] if member_id else []:
        session.add(DocumentLink(document_id=doc.id, entity_type=etype, entity_id=eid))
    for etype, eid in links or []:
        if etype not in LINK_TYPES:
            raise RuleViolation(f"Unknown link type {etype}", code="LinkType")
        if not (etype == "MEMBER" and eid == member_id):
            session.add(DocumentLink(document_id=doc.id, entity_type=etype, entity_id=eid))
    await session.flush()
    await session.refresh(doc, ["links"])
    audit.record(
        session,
        "UPLOAD" if not generated else "GENERATE",
        f"{'Generated' if generated else 'Uploaded'} document {safe_name}",
        entity_type="documents",
        entity_id=doc.id,
        entity_ref=safe_name,
        member_id=member_id,
    )
    return doc


async def signed_url(session: AsyncSession, doc_id: uuid.UUID, user: User, inline: bool) -> dict[str, Any]:
    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if doc is None:
        raise NotFound("Document not found")
    if doc.scan_status != "CLEAN":
        raise RuleViolation(f"Document is quarantined (scan status {doc.scan_status})", code="Quarantined")
    dt = await session.get(DocumentType, doc.document_type_id)
    if dt and dt.is_kyc and "kyc.view_full" not in user.permission_codes():
        raise Forbidden("Permission kyc.view_full is required to open KYC documents", code="PermissionDenied")
    if dt and (dt.is_sensitive or dt.is_kyc):
        audit.record(
            session,
            "SENSITIVE_DOWNLOAD" if not inline else "SENSITIVE_VIEW",
            f"{'Viewed' if inline else 'Downloaded'} {dt.code} document {doc.file_name}",
            entity_type="documents",
            entity_id=doc.id,
            entity_ref=doc.file_name,
            member_id=doc.member_id,
        )
    store = get_blob_store()
    refresh = getattr(store, "refresh_delegation_key", None)
    if refresh is not None:  # Azure: user-delegation key for the SAS (no account keys in the app)
        await refresh()
    return {
        "url": store.read_url(doc.blob_path, doc.file_name, inline),
        "content_type": doc.content_type,
        "file_name": doc.file_name,
        "expires_in_seconds": 600,
    }


async def soft_delete(session: AsyncSession, doc_id: uuid.UUID, reason: str, user: User) -> Document:
    from app.core.timeutil import now_utc

    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if doc is None:
        raise NotFound("Document not found")
    session.info["reason"] = reason
    doc.deleted_at, doc.deleted_by, doc.deleted_reason = now_utc(), user.id, reason
    await session.flush()
    return doc


async def refresh_scan_results(session: AsyncSession, limit: int = 500) -> int:
    """Idempotent job: copy Defender's blob-tag verdict onto PENDING documents. Returns documents updated."""
    from app.storage.blob import DEFENDER_RESULT_TAG

    store = get_blob_store()
    pending = (
        (await session.execute(select(Document).where(Document.scan_status == "PENDING").limit(limit))).scalars().all()
    )
    updated = 0
    for doc in pending:
        verdict = (await store.get_tags(doc.blob_path)).get(DEFENDER_RESULT_TAG)
        if verdict:
            await mark_scan_result(session, doc.blob_path, verdict)
            updated += 1
    return updated


async def mark_scan_result(session: AsyncSession, blob_path: str, result: str) -> None:
    doc = (await session.execute(select(Document).where(Document.blob_path == blob_path))).scalar_one_or_none()
    if doc is None:
        return
    doc.scan_status = "CLEAN" if result.lower() in ("no threats found", "clean") else "INFECTED"
    audit.record(
        session,
        "SCAN_RESULT",
        f"Scan result for {doc.file_name}: {doc.scan_status}",
        entity_type="documents",
        entity_id=doc.id,
        member_id=doc.member_id,
    )
