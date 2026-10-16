import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamps, UUIDPk, utcnow


class EntitlementYear(Base, UUIDPk, Timestamps):
    """Bucket header per member per membership year. Rows are locked FOR UPDATE while deducting."""

    __tablename__ = "entitlement_years"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    year: Mapped[int] = mapped_column(SmallInteger)
    allocated: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    resort_category_code: Mapped[str] = mapped_column(String(40))
    season_code: Mapped[str] = mapped_column(String(40))
    unit_type_code: Mapped[str] = mapped_column(String(40))
    __table_args__ = (Index("uq_ent_year", "member_id", "year", unique=True),)


class EntitlementLedger(Base, UUIDPk):
    """Append-only movements. Balance per bucket = SUM(delta)."""

    __tablename__ = "entitlement_ledger"
    __audited__ = False
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    origin_year: Mapped[int] = mapped_column(SmallInteger)
    use_year: Mapped[int | None] = mapped_column(SmallInteger)
    entry_type: Mapped[str] = mapped_column(String(20))
    delta: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id", use_alter=True), index=True)
    joining_offer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("joining_offers.id"))
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (
        Index("ix_ent_ledger_bucket", "member_id", "origin_year"),
        CheckConstraint("delta <> 0", name="delta_nonzero"),
    )


class ReservationDeduction(Base, UUIDPk, Timestamps):
    """Exactly one active deduction per reservation (unique index), tracking the current plan per bucket."""

    __tablename__ = "reservation_deductions"
    __audited__ = False
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id", use_alter=True))
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    state: Mapped[str] = mapped_column(String(12))  # HELD | DEDUCTED | RELEASED | CANCELLED
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)  # {"lines": [{"year", "kind", "nights"}]}
    use_year: Mapped[int] = mapped_column(SmallInteger)
    revision: Mapped[int] = mapped_column(SmallInteger, default=1)
    __table_args__ = (
        Index(
            "uq_active_deduction", "reservation_id", unique=True, postgresql_where=text("state in ('HELD','DEDUCTED')")
        ),
    )
