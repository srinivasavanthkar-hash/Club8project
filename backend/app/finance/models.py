import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, SoftDelete, Timestamps, UUIDPk, Versioned


class PaymentSchedule(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "payment_schedules"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="EMI")
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    emi_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    emi_count: Mapped[int] = mapped_column(Integer)
    start_year: Mapped[int] = mapped_column(SmallInteger)
    start_month: Mapped[int] = mapped_column(SmallInteger)
    generation_warning: Mapped[str | None] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(default=True)
    instalments: Mapped[list["ScheduleInstalment"]] = relationship(
        order_by="ScheduleInstalment.number", lazy="selectin", back_populates="schedule"
    )

    __table_args__ = (Index("uq_active_schedule", "member_id", unique=True, postgresql_where=text("is_active")),)


class ScheduleInstalment(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "schedule_instalments"
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_schedules.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(index=True)
    amount_due: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    status: Mapped[str] = mapped_column(String(12), default="PENDING", index=True)
    schedule: Mapped[PaymentSchedule] = relationship(back_populates="instalments")
    __table_args__ = (
        CheckConstraint("amount_due > 0", name="due_pos"),
        CheckConstraint("amount_paid >= 0", name="paid_nonneg"),
        Index("uq_instalment_number", "schedule_id", "number", unique=True),
    )


class Payment(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    """Never silently edited: corrections create a REVERSAL/ADJUSTMENT row linked via `corrects_payment_id`."""

    __tablename__ = "payments"
    __audit_ref__ = "receipt_number"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"))
    payment_type_code: Mapped[str] = mapped_column(String(40), index=True)
    entry_kind: Mapped[str] = mapped_column(String(12), default="NORMAL")  # NORMAL | REVERSAL | ADJUSTMENT
    corrects_payment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payments.id"))
    base_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(7, 4), default=Decimal(0))
    gst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    due_date: Mapped[date | None] = mapped_column()
    payment_date: Mapped[date] = mapped_column(index=True)
    payment_method_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_methods.id"))
    transaction_ref: Mapped[str | None] = mapped_column(String(100))
    cheque_number: Mapped[str | None] = mapped_column(String(30))
    bank_name: Mapped[str | None] = mapped_column(String(100))
    card_last4: Mapped[str | None] = mapped_column(String(4))
    receipt_number: Mapped[str] = mapped_column(String(40), unique=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id", use_alter=True), index=True)
    asf_charge_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("asf_charges.id", use_alter=True))
    asf_year: Mapped[int | None] = mapped_column(SmallInteger)
    is_forfeited: Mapped[bool] = mapped_column(default=False)
    correction_reason: Mapped[str | None] = mapped_column(String(500))
    receipt_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", use_alter=True))

    __table_args__ = (
        CheckConstraint("total_amount = base_amount + gst_amount", name="total_eq"),
        CheckConstraint("card_last4 is null or card_last4 ~ '^[0-9]{4}$'", name="card_last4"),
        CheckConstraint("entry_kind in ('NORMAL','REVERSAL','ADJUSTMENT')", name="entry_kind"),
        CheckConstraint("entry_kind <> 'NORMAL' or base_amount > 0", name="normal_positive"),
    )


class PaymentAllocation(Base, UUIDPk):
    __tablename__ = "payment_allocations"
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    instalment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_instalments.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))


class AsfCharge(Base, UUIDPk, Timestamps, Versioned):
    """One per member per membership year (unique). Raised at first booking using that year's nights."""

    __tablename__ = "asf_charges"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    membership_year: Mapped[int] = mapped_column(SmallInteger)
    raised_on: Mapped[date] = mapped_column()
    raised_by_reservation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reservations.id", use_alter=True))
    reason: Mapped[str] = mapped_column(String(30))  # CURRENT | BORROWED | SAVED_SOURCE_UNRAISED
    asf_rate_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("asf_rates.id"))
    base_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    gst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    status: Mapped[str] = mapped_column(String(12), default="RAISED")  # RAISED | PAID
    __table_args__ = (Index("uq_asf_member_year", "member_id", "membership_year", unique=True),)


class ReservationAsfLink(Base, UUIDPk):
    """Which ASF charges a reservation depends on (confirmation is gated on all of them being PAID)."""

    __tablename__ = "reservation_asf_links"
    __audited__ = False
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reservations.id", use_alter=True), index=True)
    asf_charge_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("asf_charges.id"))
    __table_args__ = (Index("uq_res_asf", "reservation_id", "asf_charge_id", unique=True),)


class Receipt(Base, UUIDPk, Timestamps):
    __tablename__ = "receipts"
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", use_alter=True))
    is_external_copy: Mapped[bool] = mapped_column(default=False)


class DefaultNotice(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "default_notices"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    issued_on: Mapped[date] = mapped_column()
    deadline: Mapped[date] = mapped_column()
    amount_overdue: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    status: Mapped[str] = mapped_column(String(12), default="OPEN")  # OPEN | CURED | TERMINATED
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", use_alter=True))
    resolved_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (Index("uq_open_notice", "member_id", unique=True, postgresql_where=text("status = 'OPEN'")),)
