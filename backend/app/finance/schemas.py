import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.schemas import ORM, DecStr, MoneyIn


class PaymentIn(BaseModel):
    payment_type_code: str = Field(max_length=40)
    base_amount: MoneyIn = Field(gt=0)
    currency: str = Field("INR", min_length=3, max_length=3)
    payment_date: date
    due_date: date | None = None
    payment_method_id: uuid.UUID
    transaction_ref: str | None = Field(None, max_length=100)
    cheque_number: str | None = Field(None, max_length=30)
    bank_name: str | None = Field(None, max_length=100)
    card_last4: str | None = Field(None, pattern=r"^\d{4}$")
    remarks: str | None = Field(None, max_length=2000)
    reservation_id: uuid.UUID | None = None
    asf_charge_id: uuid.UUID | None = None
    allocate_to: list[uuid.UUID] | None = None  # specific instalments; default oldest first

    @field_validator("card_last4", mode="before")
    @classmethod
    def _no_pan(cls, v: str | None) -> str | None:
        if v and len("".join(c for c in v if c.isdigit())) > 4:
            raise ValueError("Never enter full card numbers; only the last 4 digits")
        return v


class AllocationOut(ORM):
    instalment_id: uuid.UUID
    amount: DecStr


class PaymentOut(ORM):
    id: uuid.UUID
    member_id: uuid.UUID
    payment_type_code: str
    entry_kind: str
    corrects_payment_id: uuid.UUID | None
    base_amount: DecStr
    gst_rate: DecStr
    gst_amount: DecStr
    total_amount: DecStr
    currency: str
    due_date: date | None
    payment_date: date
    payment_method_id: uuid.UUID
    transaction_ref: str | None
    cheque_number: str | None
    bank_name: str | None
    card_last4: str | None
    receipt_number: str
    remarks: str | None
    reservation_id: uuid.UUID | None
    asf_charge_id: uuid.UUID | None
    asf_year: int | None
    is_forfeited: bool
    receipt_document_id: uuid.UUID | None
    correction_reason: str | None
    created_at: datetime
    version: int


class PaymentResult(BaseModel):
    payment: PaymentOut
    allocations: list[AllocationOut]
    credit_carried_forward: DecStr
    member_status: str


class CorrectionIn(BaseModel):
    kind: Literal["REVERSAL", "ADJUSTMENT"]
    reason: str = Field(min_length=5, max_length=500)
    amount: Decimal | None = Field(None, max_digits=14, decimal_places=2)  # ADJUSTMENT: signed base amount


class PaymentMetaPatch(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
    version: int
    transaction_ref: str | None = None
    cheque_number: str | None = None
    bank_name: str | None = None
    remarks: str | None = None
    payment_date: date | None = None


class ScheduleIn(BaseModel):
    """All optional: defaults come from the member's application form fields."""

    balance: MoneyIn | None = None
    emi_amount: MoneyIn | None = None
    emi_count: int | None = Field(None, ge=1, le=240)
    start_year: int | None = Field(None, ge=2000, le=2100)
    start_month: int | None = Field(None, ge=1, le=12)
    due_day: int | None = Field(None, ge=1, le=28)


class InstalmentOut(ORM):
    id: uuid.UUID
    number: int
    due_date: date
    amount_due: DecStr
    amount_paid: DecStr
    status: str
    version: int


class ScheduleOut(ORM):
    id: uuid.UUID
    balance: DecStr
    emi_amount: DecStr
    emi_count: int
    start_year: int
    start_month: int
    generation_warning: str | None
    instalments: list[InstalmentOut]


class InstalmentPatch(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
    version: int
    due_date: date | None = None
    amount_due: MoneyIn | None = None


class AsfChargeOut(ORM):
    id: uuid.UUID
    membership_year: int
    raised_on: date
    reason: str
    base_amount: DecStr
    gst_rate: DecStr
    gst_amount: DecStr
    total_amount: DecStr
    currency: str
    amount_paid: DecStr
    status: str
    raised_by_reservation_id: uuid.UUID | None


class AsfYearStatus(BaseModel):
    membership_year: int
    status: str  # NOT_YET_DUE | RAISED | PAID
    charge: AsfChargeOut | None = None
    receipt_numbers: list[str] = []


class NoticeOut(ORM):
    id: uuid.UUID
    issued_on: date
    deadline: date
    amount_overdue: DecStr
    currency: str
    status: str
    document_id: uuid.UUID | None


class TerminateIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
