"""Master data. Everything rate/price/rule-like is here, effective-dated where relevant."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, EffectiveDated, Timestamps, UUIDPk, Versioned


class _Coded(UUIDPk, Timestamps, Versioned):
    __audit_ref__: str | None = "code"
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Company(Base, _Coded):
    __tablename__ = "companies"
    legal_name: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str] = mapped_column(String(100))
    membership_prefix: Mapped[str] = mapped_column(String(20))
    receipt_prefix: Mapped[str] = mapped_column(String(20))
    registered_address: Mapped[str] = mapped_column(Text, default="")
    gstin: Mapped[str | None] = mapped_column(String(15))
    next_membership_seq: Mapped[int] = mapped_column(Integer, default=1)
    # Branding for generated documents (docs/BRAND_PROMPT.md section 5). logo_path is relative to the brand asset
    # folder, e.g. "club8/club8-logo.png"; colours are "#RRGGBB" (validated before use in PDF styles).
    logo_path: Mapped[str] = mapped_column(String(200), default="")
    primary_colour: Mapped[str] = mapped_column(String(7), default="")
    accent_colour: Mapped[str] = mapped_column(String(7), default="")
    # True until the client confirms the legal entity / address; blocks issuing receipts in production.
    details_pending_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)


class ResortCategory(Base, _Coded):
    __tablename__ = "resort_categories"


class Season(Base, _Coded):
    __tablename__ = "seasons"
    description: Mapped[str] = mapped_column(String(100), default="")  # e.g. "Peak"
    priority: Mapped[int] = mapped_column(Integer, default=0)  # lower = higher priority when deriving


class SeasonCalendar(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "season_calendar"
    season_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("seasons.id"))
    destination_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("destinations.id"))  # None = all
    start_date: Mapped[date] = mapped_column()
    end_date: Mapped[date] = mapped_column()
    __table_args__ = (CheckConstraint("end_date >= start_date", name="dates"),)


class UnitType(Base, _Coded):
    __tablename__ = "unit_types"
    max_adults: Mapped[int] = mapped_column(Integer)
    max_children: Mapped[int] = mapped_column(Integer)
    child_age_limit: Mapped[int] = mapped_column(Integer)
    max_total: Mapped[int] = mapped_column(Integer)
    occupancy_text: Mapped[str] = mapped_column(String(150), default="")


class Product(Base, _Coded):
    __tablename__ = "products"
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"))
    description: Mapped[str] = mapped_column(Text, default="")
    allowed_tenures: Mapped[list[int]] = mapped_column(JSONB, default=list)


class ProductCustomField(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "product_custom_fields"
    __audit_ref__ = "field_key"
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"))  # None = all products
    field_key: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(150))
    field_type: Mapped[str] = mapped_column(String(20))  # text|number|date|bool|select
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    options: Mapped[list[str] | None] = mapped_column(JSONB)
    section: Mapped[str] = mapped_column(String(60), default="Membership Details")
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("product_id", "field_key", name="product_field"),)


class JoiningOfferType(Base, _Coded):
    __tablename__ = "joining_offer_types"
    credits_nights: Mapped[bool] = mapped_column(Boolean, default=True)


class TaxRate(Base, UUIDPk, Timestamps, Versioned, EffectiveDated):
    __tablename__ = "tax_rates"
    __audit_ref__ = "code"
    code: Mapped[str] = mapped_column(String(20))  # e.g. GST_ASF
    rate_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4))


class AsfRate(Base, UUIDPk, Timestamps, Versioned, EffectiveDated):
    __tablename__ = "asf_rates"
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id"))
    unit_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("unit_types.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    tax_code: Mapped[str] = mapped_column(String(20), default="GST_ASF")
    override_reason: Mapped[str | None] = mapped_column(String(500))
    __table_args__ = (
        UniqueConstraint("company_id", "unit_type_id", "effective_from", name="asf_unique_from"),
        CheckConstraint("amount >= 0", name="amount_nonneg"),
    )


class DeductionMatrix(Base, UUIDPk, Timestamps, Versioned, EffectiveDated):
    __tablename__ = "deduction_matrix"
    booked_category: Mapped[str | None] = mapped_column(String(40))
    booked_season: Mapped[str | None] = mapped_column(String(40))
    booked_unit_type: Mapped[str | None] = mapped_column(String(40))
    purchased_category: Mapped[str | None] = mapped_column(String(40))
    purchased_season: Mapped[str | None] = mapped_column(String(40))
    purchased_unit_type: Mapped[str | None] = mapped_column(String(40))
    multiplier: Mapped[Decimal] = mapped_column(Numeric(6, 3))
    __table_args__ = (CheckConstraint("multiplier > 0", name="multiplier_pos"),)


class CancellationTier(Base, UUIDPk, Timestamps, Versioned, EffectiveDated):
    __tablename__ = "cancellation_tiers"
    min_days: Mapped[int] = mapped_column(Integer)
    max_days: Mapped[int | None] = mapped_column(Integer)
    credit_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    rounding_mode: Mapped[str] = mapped_column(String(10), default="DOWN")


class PaymentType(Base, _Coded):
    __tablename__ = "payment_types"
    gst_applicable: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_code: Mapped[str | None] = mapped_column(String(20))
    requires_reservation: Mapped[bool] = mapped_column(Boolean, default=False)


class PaymentMethod(Base, _Coded):
    __tablename__ = "payment_methods"
    requires_reference: Mapped[bool] = mapped_column(Boolean, default=True)
    allows_card_last4: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_bank: Mapped[bool] = mapped_column(Boolean, default=False)


class Currency(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "currencies"
    __audit_ref__ = "code"
    code: Mapped[str] = mapped_column(String(3), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    symbol: Mapped[str] = mapped_column(String(5))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class DocumentType(Base, _Coded):
    __tablename__ = "document_types"
    is_kyc: Mapped[bool] = mapped_column(Boolean, default=False)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)  # downloads are logged


class Venue(Base, _Coded):
    __tablename__ = "venues"
    city: Mapped[str] = mapped_column(String(100), default="")


class LeadSource(Base, _Coded):
    __tablename__ = "lead_sources"


class Destination(Base, _Coded):
    __tablename__ = "destinations"
    country: Mapped[str] = mapped_column(String(60), default="India")


class Property(Base, _Coded):
    __tablename__ = "properties"
    destination_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("destinations.id"))
    resort_category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resort_categories.id"))
    address: Mapped[str] = mapped_column(Text, default="")


class Reason(Base, _Coded):
    __tablename__ = "reasons"
    kind: Mapped[str] = mapped_column(String(30))  # DECLINE | CANCEL | CALL_OUTCOME | DUPLICATE_OVERRIDE ...


class HolidayCalendar(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "holiday_calendar"
    holiday_date: Mapped[date] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(String(100))


class StatusDefinition(Base, UUIDPk, Timestamps, Versioned):
    """Configurable statuses and transitions per entity (seeded from app.core.state_machine)."""

    __tablename__ = "status_definitions"
    entity: Mapped[str] = mapped_column(String(30))
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    allowed_next: Mapped[list[str]] = mapped_column(JSONB, default=list)
    __table_args__ = (UniqueConstraint("entity", "code", name="entity_code"),)


class SystemSetting(Base, UUIDPk, Timestamps, Versioned):
    """Key/value configuration (business-rule parameters). See docs/BUSINESS_RULES.md for keys."""

    __tablename__ = "system_settings"
    __audit_ref__ = "key"
    key: Mapped[str] = mapped_column(String(100), unique=True)
    value: Mapped[Any] = mapped_column(JSONB)
    description: Mapped[str] = mapped_column(Text, default="")


class LetterTemplate(Base, _Coded):
    __tablename__ = "letter_templates"
    subject: Mapped[str] = mapped_column(String(200), default="")
    body_html: Mapped[str] = mapped_column(Text)  # Jinja2 (sandboxed)


class Sequence_(Base):
    """Gap-free counters (lead id, receipts per company, reservation id). Row-locked on increment."""

    __tablename__ = "number_sequences"
    __audited__ = False
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, default=1)


class SavedSearch(Base, UUIDPk, Timestamps):
    __tablename__ = "saved_searches"
    __audited__ = False
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    entity: Mapped[str] = mapped_column(String(30))  # leads | members | payments | reservations | activity
    name: Mapped[str] = mapped_column(String(100))
    filters: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
