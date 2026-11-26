import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, SoftDelete, Timestamps, UUIDPk, Versioned, utcnow


class Member(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    """The single member id (members.id) keys every tab: finance, reservations, entitlement, correspondence."""

    __tablename__ = "members"
    __audit_ref__ = "membership_number"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"))
    membership_number: Mapped[str] = mapped_column(String(30), unique=True)  # MSMC8-9030
    membership_seq: Mapped[str] = mapped_column(String(20), index=True)  # 9030 (prefix-free search)
    number_series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("membership_number_series.id"), index=True)
    # Optional: the property the membership is linked to (a number series may apply to one property only)
    home_property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("properties.id"))
    status: Mapped[str] = mapped_column(String(30), default="PENDING_APPROVAL", index=True)

    email: Mapped[str] = mapped_column(String(255), index=True)
    address_line1: Mapped[str] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    postcode: Mapped[str | None] = mapped_column(String(12))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(60), default="India")

    purchase_date: Mapped[date] = mapped_column()
    tenure_years: Mapped[int] = mapped_column(SmallInteger)
    first_year_of_use: Mapped[int] = mapped_column(SmallInteger)
    last_year_of_use: Mapped[int] = mapped_column(SmallInteger)
    last_year_override_reason: Mapped[str | None] = mapped_column(String(500))
    resort_category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resort_categories.id"))
    season_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("seasons.id"))
    unit_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("unit_types.id"))
    nights_per_year: Mapped[Decimal] = mapped_column(Numeric(5, 1))

    currency: Mapped[str] = mapped_column(String(3), default="INR")
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    admin_fees: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    total_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    down_payment_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    down_payment_method_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payment_methods.id"))
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    balance_mode: Mapped[str] = mapped_column(String(10), default="NONE")  # NONE | EMI | OTHER
    emi_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    emi_count: Mapped[int | None] = mapped_column(Integer)
    emi_start_month: Mapped[int | None] = mapped_column(SmallInteger)
    emi_start_year: Mapped[int | None] = mapped_column(SmallInteger)
    instalment_start_date: Mapped[date | None] = mapped_column()
    balance_other_text: Mapped[str | None] = mapped_column(String(300))

    relationship_manager_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    team_manager_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column()
    comments: Mapped[str | None] = mapped_column(Text)

    agreement_signed_applicant1: Mapped[bool] = mapped_column(Boolean, default=False)
    agreement_signed_applicant2: Mapped[bool] = mapped_column(Boolean, default=False)
    agreement_signed_company: Mapped[bool] = mapped_column(Boolean, default=False)
    agreement_signed_date: Mapped[date | None] = mapped_column()

    source_lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id"), unique=True)
    opc_name: Mapped[str | None] = mapped_column(String(150))
    venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    custom_fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    duplicate_override_reason: Mapped[str | None] = mapped_column(String(500))
    credit_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))

    applicants: Mapped[list["MemberApplicant"]] = relationship(
        back_populates="member", order_by="MemberApplicant.position", lazy="selectin"
    )
    joining_offers: Mapped[list["JoiningOffer"]] = relationship(back_populates="member", lazy="selectin")

    __table_args__ = (
        CheckConstraint("total_price = purchase_price + admin_fees", name="total_eq_price_plus_fees"),
        CheckConstraint("balance = total_price - down_payment_amount", name="balance_eq"),
        CheckConstraint("last_year_of_use >= first_year_of_use", name="years"),
        CheckConstraint("nights_per_year > 0", name="nights_pos"),
        CheckConstraint("balance_mode in ('NONE','EMI','OTHER')", name="balance_mode"),
        Index("ix_members_custom_fields", "custom_fields", postgresql_using="gin"),
    )


class MemberApplicant(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "member_applicants"
    __audit_ref__ = "full_name"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    position: Mapped[int] = mapped_column(SmallInteger)  # 1 or 2
    full_name: Mapped[str] = mapped_column(String(150))
    name_norm: Mapped[str] = mapped_column(String(150))
    dob: Mapped[date] = mapped_column()
    mobile: Mapped[str | None] = mapped_column(String(20), index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    member: Mapped[Member] = relationship(back_populates="applicants")
    # active (non-deleted) KYC identifiers only; replaced IDs remain in applicant_kyc as history
    kyc: Mapped[list["ApplicantKyc"]] = relationship(
        primaryjoin="and_(ApplicantKyc.applicant_id == MemberApplicant.id, ApplicantKyc.deleted_at.is_(None))",
        lazy="selectin",
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint("position in (1, 2)", name="position"),
        Index("uq_member_applicant_pos", "member_id", "position", unique=True),
        # trigram GIN index on name_norm is created in the migration (needs pg_trgm)
    )


class ApplicantKyc(Base, UUIDPk, Timestamps, Versioned, SoftDelete):
    """One row per ID. Sensitive numbers are envelope-encrypted; `masked` is safe to display.
    `lookup_hash` (HMAC) allows duplicate checks on PAN without decrypting."""

    __tablename__ = "applicant_kyc"
    applicant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("member_applicants.id"), index=True)
    id_type: Mapped[str] = mapped_column(String(20))  # AADHAAR | PAN | DL | PASSPORT | VOTER_ID
    value_encrypted: Mapped[str | None] = mapped_column(Text)
    masked: Mapped[str] = mapped_column(String(40))
    lookup_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    expiry_date: Mapped[date | None] = mapped_column()
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", use_alter=True))
    applicant: Mapped[MemberApplicant] = relationship()

    __table_args__ = (CheckConstraint("id_type in ('AADHAAR','PAN','DL','PASSPORT','VOTER_ID')", name="id_type"),)


class JoiningOffer(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "joining_offers"
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    offer_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("joining_offer_types.id"))
    description: Mapped[str] = mapped_column(String(300))
    nights: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    valid_until: Mapped[date | None] = mapped_column()
    credit_year: Mapped[int | None] = mapped_column(SmallInteger)  # entitlement bucket for bonus nights
    member: Mapped[Member] = relationship(back_populates="joining_offers")


class MemberStatusHistory(Base, UUIDPk):
    __tablename__ = "member_status_history"
    __audited__ = False
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    changed_at: Mapped[datetime] = mapped_column(default=utcnow)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(String(500))
