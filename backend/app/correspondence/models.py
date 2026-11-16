import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, SoftDelete, Timestamps, UUIDPk, Versioned


class EmailThread(Base, UUIDPk, Timestamps):
    __tablename__ = "email_threads"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    subject: Mapped[str] = mapped_column(String(500))
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id"))


class Email(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    __tablename__ = "emails"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    thread_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("email_threads.id"), index=True)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id"), index=True)
    direction: Mapped[str] = mapped_column(String(10))  # INCOMING | OUTGOING
    sent_at: Mapped[datetime] = mapped_column()
    sender: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(500))
    body_text: Mapped[str] = mapped_column(Text, default="")
    body_html: Mapped[str | None] = mapped_column(Text)  # stored, rendered sanitised only
    message_id: Mapped[str | None] = mapped_column(String(500), index=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(10), default="MANUAL")  # MANUAL | EML | MSG | SYNC
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"))
    recipients: Mapped[list["EmailRecipient"]] = relationship(lazy="selectin")
    __table_args__ = (CheckConstraint("direction in ('INCOMING','OUTGOING')", name="direction"),)


class EmailRecipient(Base, UUIDPk):
    __tablename__ = "email_recipients"
    __audited__ = False
    email_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("emails.id"), index=True)
    kind: Mapped[str] = mapped_column(String(3))  # TO | CC | BCC
    address: Mapped[str] = mapped_column(String(320))


class Call(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    __tablename__ = "calls"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id"))
    direction: Mapped[str] = mapped_column(String(10))
    called_at: Mapped[datetime] = mapped_column()
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    contact_number: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(Text)
    outcome_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reasons.id"))
    next_action: Mapped[str | None] = mapped_column(String(300))
    next_action_date: Mapped[date | None] = mapped_column(index=True)
    next_action_done: Mapped[bool] = mapped_column(default=False)
    recording_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"))
    __table_args__ = (CheckConstraint("direction in ('INCOMING','OUTGOING')", name="direction"),)


class Document(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    __tablename__ = "documents"
    __audit_ref__ = "file_name"
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id", use_alter=True), index=True)
    document_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("document_types.id"))
    description: Mapped[str | None] = mapped_column(String(500))
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    blob_path: Mapped[str] = mapped_column(String(500), unique=True)
    scan_status: Mapped[str] = mapped_column(String(12), default="PENDING")  # PENDING|CLEAN|INFECTED|ERROR
    is_generated: Mapped[bool] = mapped_column(default=False)
    # A document that no longer holds (e.g. the voucher of a cancelled reservation): kept, marked, never deleted
    voided_at: Mapped[datetime | None] = mapped_column()
    void_reason: Mapped[str | None] = mapped_column(String(300))
    links: Mapped[list["DocumentLink"]] = relationship(lazy="selectin")


class DocumentLink(Base, UUIDPk):
    __tablename__ = "document_links"
    __audited__ = False
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(20))  # MEMBER|APPLICANT|PAYMENT|RESERVATION|EMAIL|CALL|LEAD
    entity_id: Mapped[uuid.UUID] = mapped_column()
    __table_args__ = (Index("ix_doc_links_entity", "entity_type", "entity_id"),)
