import uuid
from datetime import date, datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, SoftDelete, Timestamps, UUIDPk, Versioned, utcnow


class Lead(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    __tablename__ = "leads"
    __audit_ref__ = "lead_number"

    lead_number: Mapped[str] = mapped_column(String(20), unique=True)  # L-2026-000123
    entry_date: Mapped[date] = mapped_column()
    prospect_name: Mapped[str] = mapped_column(String(150))
    name_norm: Mapped[str] = mapped_column(String(150))
    mobile: Mapped[str] = mapped_column(String(20))  # normalised
    whatsapp: Mapped[str | None] = mapped_column(String(20))
    whatsapp_same_as_mobile: Mapped[bool] = mapped_column(default=False)
    email: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(100))
    venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    source_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("lead_sources.id"))
    opc_name: Mapped[str | None] = mapped_column(String(150))
    salesperson_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    follow_up_date: Mapped[date | None] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(String(40), default="NEW", index=True)
    presentation_at: Mapped[datetime | None] = mapped_column()
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id", use_alter=True))
    converted_at: Mapped[datetime | None] = mapped_column()
    duplicate_override_reason: Mapped[str | None] = mapped_column(String(500))

    notes: Mapped[list["LeadNote"]] = relationship(
        back_populates="lead", order_by="LeadNote.created_at", lazy="selectin"
    )

    __table_args__ = (
        # trigram GIN index on name_norm is created in the migration (needs pg_trgm)
        Index("ix_leads_mobile", "mobile"),
        Index("ix_leads_email", "email"),
    )


class LeadNote(Base, UUIDPk):
    __tablename__ = "lead_notes"
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id"), index=True)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    lead: Mapped[Lead] = relationship(back_populates="notes")


class LeadStatusHistory(Base, UUIDPk):
    __tablename__ = "lead_status_history"
    __audited__ = False
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(40))
    to_status: Mapped[str] = mapped_column(String(40))
    changed_at: Mapped[datetime] = mapped_column(default=utcnow)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(500))
