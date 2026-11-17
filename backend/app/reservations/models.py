import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, SoftDelete, Timestamps, UUIDPk, Versioned, utcnow


class Reservation(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    __tablename__ = "reservations"
    __audit_ref__ = "reservation_number"
    reservation_number: Mapped[str] = mapped_column(String(20), unique=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    request_date: Mapped[date] = mapped_column()
    destination_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("destinations.id"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    resort_category_code: Mapped[str] = mapped_column(String(40))  # snapshot from property
    season_code: Mapped[str] = mapped_column(String(40))
    season_overridden: Mapped[bool] = mapped_column(default=False)
    unit_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("unit_types.id"))
    rooms: Mapped[int] = mapped_column(SmallInteger, default=1)
    adults: Mapped[int] = mapped_column(SmallInteger)
    child_ages: Mapped[list[int]] = mapped_column(JSONB, default=list)
    occupancy_type: Mapped[str] = mapped_column(String(10), default="SELF")
    guest_name: Mapped[str | None] = mapped_column(String(150))
    guest_contact: Mapped[str | None] = mapped_column(String(50))
    member_communication_ref: Mapped[str | None] = mapped_column(String(80))  # "email:<id>" | "call:<id>"
    check_in: Mapped[date] = mapped_column(index=True)
    check_out: Mapped[date] = mapped_column()
    nights: Mapped[int] = mapped_column(Integer)
    entitlement_nights: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    additional_paid_nights: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=Decimal(0))
    deduction_explanation: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="REQUESTED", index=True)
    confirmation_number: Mapped[str | None] = mapped_column(String(80))
    reschedule_count: Mapped[int] = mapped_column(SmallInteger, default=0)
    remarks: Mapped[str | None] = mapped_column(Text)
    warnings_overridden: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {warning: reason}
    # Facts of a confirmed cancellation (notice date and its source, tier, nights, ASF withdrawn, letter); D-31..D-34
    cancellation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    status_history: Mapped[list["ReservationStatusHistory"]] = relationship(
        order_by="ReservationStatusHistory.changed_at", lazy="selectin"
    )
    date_versions: Mapped[list["ReservationDateVersion"]] = relationship(
        order_by="ReservationDateVersion.version_no", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("check_out > check_in", name="dates"),
        CheckConstraint("occupancy_type in ('SELF','GIFT','RENT')", name="occupancy_type"),
        CheckConstraint("adults >= 1 and rooms >= 1", name="pax"),
    )


class ReservationStatusHistory(Base, UUIDPk):
    __tablename__ = "reservation_status_history"
    __audited__ = False
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    changed_at: Mapped[datetime] = mapped_column(default=utcnow)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reason_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reasons.id"))
    reason_text: Mapped[str | None] = mapped_column(String(1000))
    override: Mapped[bool] = mapped_column(default=False)


class ReservationDateVersion(Base, UUIDPk):
    """Dates are never overwritten: version 1 = original, each reschedule appends a version."""

    __tablename__ = "reservation_date_versions"
    __audited__ = False
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id"), index=True)
    version_no: Mapped[int] = mapped_column(SmallInteger)
    check_in: Mapped[date] = mapped_column()
    check_out: Mapped[date] = mapped_column()
    entitlement_nights: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(String(500))
