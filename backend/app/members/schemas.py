"""Member application schemas. Field order mirrors the paper Membership Application Form (FORM_MAPPING.md)."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.schemas import ORM, DecStr, MoneyIn, NightsIn
from app.core.validators import validate_mobile, validate_pin

IdType = Literal["AADHAAR", "PAN", "DL", "PASSPORT", "VOTER_ID"]


class KycIn(BaseModel):
    id_type: IdType
    value: str = Field(min_length=4, max_length=40)
    expiry_date: date | None = None
    document_id: uuid.UUID | None = None


class ApplicantIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    dob: date
    mobile: str | None = None
    email: EmailStr | None = None
    kyc: list[KycIn] = Field(default_factory=list)

    @field_validator("mobile")
    @classmethod
    def _m(cls, v: str | None) -> str | None:
        return validate_mobile(v) if v else None


class AddressIn(BaseModel):
    line1: str = Field(min_length=2, max_length=200)
    line2: str | None = Field(None, max_length=200)
    city: str = Field(min_length=2, max_length=100)
    postcode: str | None = None
    state: str | None = Field(None, max_length=100)
    country: str = "India"

    @model_validator(mode="after")
    def _india(self) -> "AddressIn":
        if self.country.strip().lower() == "india":
            if not self.postcode:
                raise ValueError("PIN code is required for Indian addresses")
            self.postcode = validate_pin(self.postcode)
            if not self.state:
                raise ValueError("State is required for Indian addresses")
        return self


class JoiningOfferIn(BaseModel):
    offer_type_id: uuid.UUID
    description: str = Field(min_length=2, max_length=300)
    nights: NightsIn | None = None
    value: MoneyIn | None = None
    valid_until: date | None = None
    credit_year: int | None = None


class DownPaymentIn(BaseModel):
    """Optional: record the down payment in Finance at save time (form field 'By:')."""

    payment_date: date
    transaction_ref: str | None = Field(None, max_length=100)
    cheque_number: str | None = Field(None, max_length=30)
    bank_name: str | None = Field(None, max_length=100)
    card_last4: str | None = Field(None, pattern=r"^\d{4}$")


class MemberIn(BaseModel):
    # Purchaser (Member) details
    applicant1: ApplicantIn
    applicant2: ApplicantIn | None = None
    address: AddressIn
    email: EmailStr
    # Membership details
    company_id: uuid.UUID
    product_id: uuid.UUID | None = None
    membership_number: str | None = Field(
        None, pattern=r"^\d{1,10}$", description="Number part only (paper members); the prefix comes from the series"
    )
    # The membership number series; when left out, the most specific series that fits is used (or an error asks
    # for a choice). GET /members/number-series lists the ones that fit.
    number_series_id: uuid.UUID | None = None
    home_property_id: uuid.UUID | None = None
    purchase_date: date
    tenure_years: int = Field(ge=1, le=99)
    first_year_of_use: int = Field(ge=2000, le=2100)
    last_year_of_use: int | None = None
    last_year_override_reason: str | None = Field(None, max_length=500)
    resort_category_id: uuid.UUID
    season_id: uuid.UUID
    unit_type_id: uuid.UUID
    nights_per_year: NightsIn = Field(gt=0)
    # Payment details
    currency: str = Field("INR", min_length=3, max_length=3)
    purchase_price: MoneyIn
    admin_fees: MoneyIn = Decimal(0)
    down_payment_amount: MoneyIn
    down_payment_method_id: uuid.UUID | None = None
    down_payment: DownPaymentIn | None = None
    balance_mode: Literal["NONE", "EMI", "OTHER"] = "NONE"
    emi_amount: MoneyIn | None = None
    emi_count: int | None = Field(None, ge=1, le=240)
    emi_start_month: int | None = Field(None, ge=1, le=12)
    emi_start_year: int | None = Field(None, ge=2000, le=2100)
    instalment_start_date: date | None = None
    balance_other_text: str | None = Field(None, max_length=300)
    # Joining offer
    joining_offers: list[JoiningOfferIn] = Field(default_factory=list)
    # Sales
    relationship_manager_id: uuid.UUID | None = None
    team_manager_id: uuid.UUID | None = None
    # Approval
    comments: str | None = Field(None, max_length=4000)
    # Signatures
    agreement_signed_applicant1: bool = False
    agreement_signed_applicant2: bool = False
    agreement_signed_company: bool = False
    agreement_signed_date: date | None = None
    # Lead carry-over / extensibility
    source_lead_id: uuid.UUID | None = None
    opc_name: str | None = None
    venue_id: uuid.UUID | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    duplicate_override_reason: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _cross(self) -> "MemberIn":
        if self.applicant2 is None and self.agreement_signed_applicant2:
            raise ValueError("Applicant 2 signature set without applicant 2")
        return self


class MemberPatch(BaseModel):
    """Editable profile fields (finance figures are changed through Finance, not here)."""

    version: int
    reason: str | None = Field(None, max_length=500)
    email: EmailStr | None = None
    address: AddressIn | None = None
    applicant1: ApplicantIn | None = None
    applicant2: ApplicantIn | None = None
    relationship_manager_id: uuid.UUID | None = None
    team_manager_id: uuid.UUID | None = None
    comments: str | None = None
    last_year_of_use: int | None = None
    agreement_signed_applicant1: bool | None = None
    agreement_signed_applicant2: bool | None = None
    agreement_signed_company: bool | None = None
    agreement_signed_date: date | None = None
    custom_fields: dict[str, Any] | None = None
    home_property_id: uuid.UUID | None = None


class KycOut(ORM):
    id: uuid.UUID
    id_type: str
    masked: str
    expiry_date: date | None
    document_id: uuid.UUID | None


class ApplicantOut(ORM):
    id: uuid.UUID
    position: int
    full_name: str
    dob: date
    mobile: str | None
    email: str | None
    kyc: list[KycOut]


class JoiningOfferOut(ORM):
    id: uuid.UUID
    offer_type_id: uuid.UUID
    description: str
    nights: DecStr | None
    value: DecStr | None
    valid_until: date | None
    credit_year: int | None


class MemberOut(ORM):
    id: uuid.UUID
    membership_number: str
    status: str
    company_id: uuid.UUID
    product_id: uuid.UUID | None
    email: str
    address_line1: str
    address_line2: str | None
    city: str
    postcode: str | None
    state: str | None
    country: str
    purchase_date: date
    tenure_years: int
    first_year_of_use: int
    last_year_of_use: int
    last_year_override_reason: str | None
    resort_category_id: uuid.UUID
    season_id: uuid.UUID
    unit_type_id: uuid.UUID
    nights_per_year: DecStr
    currency: str
    purchase_price: DecStr
    admin_fees: DecStr
    total_price: DecStr
    down_payment_amount: DecStr
    down_payment_method_id: uuid.UUID | None
    balance: DecStr
    balance_mode: str
    emi_amount: DecStr | None
    emi_count: int | None
    emi_start_month: int | None
    emi_start_year: int | None
    instalment_start_date: date | None
    relationship_manager_id: uuid.UUID | None
    team_manager_id: uuid.UUID | None
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    comments: str | None
    agreement_signed_applicant1: bool
    agreement_signed_applicant2: bool
    agreement_signed_company: bool
    agreement_signed_date: date | None
    source_lead_id: uuid.UUID | None
    opc_name: str | None
    venue_id: uuid.UUID | None
    number_series_id: uuid.UUID
    home_property_id: uuid.UUID | None
    custom_fields: dict[str, Any]
    credit_balance: DecStr
    version: int
    applicants: list[ApplicantOut]
    joining_offers: list[JoiningOfferOut]


class MemberListItem(ORM):
    id: uuid.UUID
    membership_number: str
    status: str
    company_id: uuid.UUID | None = None  # brand chip in lists
    email: str
    city: str
    purchase_date: date
    applicant_name: str | None = None
    mobile: str | None = None


class ApprovalCheck(BaseModel):
    can_approve: bool
    blockers: list[str]


class StatusIn(BaseModel):
    to_status: Literal["SUSPENDED", "ACTIVE", "EXPIRED"]
    reason: str = Field(min_length=3, max_length=500)


class KycReveal(BaseModel):
    id_type: str
    value: str
