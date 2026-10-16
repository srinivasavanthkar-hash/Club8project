import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Identity, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class ActivityLog(Base):
    """Append-only. Grants: app role has INSERT, SELECT only; trigger rejects UPDATE/DELETE/TRUNCATE.

    Rows are inserted by app.audit.service which serialises inserts with a transaction-level advisory
    lock so the hash chain is linear.
    """

    __tablename__ = "activity_log"
    __audited__ = False

    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    username: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    entity_ref: Mapped[str | None] = mapped_column(String(100))
    member_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    summary: Mapped[str] = mapped_column(Text)
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(45))  # string (not INET) so the hash round-trips exactly
    user_agent: Mapped[str | None] = mapped_column(String(400))
    request_id: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), unique=True)

    __table_args__ = (Index("ix_activity_log_entity", "entity_type", "entity_id"),)


class RecordVersion(Base):
    """Generic correction history: one row per changed record per flush."""

    __tablename__ = "record_versions"
    __audited__ = False

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    table_name: Mapped[str] = mapped_column(String(80))
    record_id: Mapped[str] = mapped_column(String(64))
    member_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    operation: Mapped[str] = mapped_column(String(10))  # INSERT | UPDATE | DELETE(soft)
    changed_at: Mapped[datetime] = mapped_column(default=utcnow)
    changed_by: Mapped[uuid.UUID | None] = mapped_column()
    reason: Mapped[str | None] = mapped_column(String(500))
    old_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (Index("ix_record_versions_record", "table_name", "record_id"),)
