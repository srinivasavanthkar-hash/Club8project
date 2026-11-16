import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.core.schemas import ORM, DecStr


class ReservationIn(BaseModel):
    destination_id: uuid.UUID
    property_id: uuid.UUID
    unit_type_id: uuid.UUID
    rooms: int = Field(1, ge=1, le=10)
    adults: int = Field(ge=1, le=20)
    child_ages: list[int] = Field(default_factory=list, max_length=10)
    occupancy_type: Literal["SELF", "GIFT", "RENT"] = "SELF"
    guest_name: str | None = Field(None, max_length=150)
    guest_contact: str | None = Field(None, max_length=50)
    member_communication_ref: str | None = Field(None, pattern=r"^(email|call):[0-9a-f-]{36}$")
    check_in: date
    check_out: date
    request_date: date | None = None
    season_override_code: str | None = None
    remarks: str | None = Field(None, max_length=2000)
    # Overrides / acknowledgements (only needed when the quote returns warnings)
    window_override_reason: str | None = Field(None, max_length=500)
    occupancy_resolution: Literal["UPGRADE_CHARGE"] | None = None
    accept_additional_paid_nights: bool = False

    @model_validator(mode="after")
    def _dates(self) -> "ReservationIn":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if any(a < 0 or a > 17 for a in self.child_ages):
            raise ValueError("child ages must be 0-17")
        return self


class Quote(BaseModel):
    stay_nights: int
    season_code: str | None
    season_derived: bool
    booked: list[str]
    purchased: list[str]
    multiplier: DecStr
    entitlement_nights_required: DecStr
    explanation: str
    plan: list[dict[str, Any]]
    entitlement_nights: DecStr
    additional_paid_nights: DecStr
    asf: list[dict[str, Any]]
    window_warnings: list[str]
    occupancy_problems: list[str]
    gift_rent_problems: list[str]
    blocking: list[str]


class StatusChangeIn(BaseModel):
    to_status: Literal["APPROVED", "CONFIRMED", "DECLINED", "CANCELLED"]
    reason_id: uuid.UUID | None = None
    reason_text: str | None = Field(None, max_length=1000)
    confirmation_number: str | None = Field(None, max_length=80)
    communication_ref: str | None = Field(None, pattern=r"^(email|document):[0-9a-f-]{36}$")
    override_reason: str | None = Field(None, max_length=500)
    # Confirmed cancellations: the notice date defaults to the day the written request was received (D-32); a
    # different date needs a reason
    cancel_date: date | None = None
    cancel_date_reason: str | None = Field(None, max_length=500)


class RescheduleIn(BaseModel):
    check_in: date
    check_out: date
    reason: str = Field(min_length=3, max_length=500)
    override_reason: str | None = Field(None, max_length=500)
    window_override_reason: str | None = None
    accept_additional_paid_nights: bool = False


class StatusHistoryOut(ORM):
    from_status: str | None
    to_status: str
    changed_at: datetime
    changed_by: uuid.UUID | None
    reason_id: uuid.UUID | None
    reason_text: str | None
    override: bool


class DateVersionOut(ORM):
    version_no: int
    check_in: date
    check_out: date
    entitlement_nights: DecStr
    created_at: datetime
    reason: str | None


class ReservationOut(ORM):
    id: uuid.UUID
    reservation_number: str
    member_id: uuid.UUID
    request_date: date
    destination_id: uuid.UUID
    property_id: uuid.UUID
    resort_category_code: str
    season_code: str
    season_overridden: bool
    unit_type_id: uuid.UUID
    rooms: int
    adults: int
    child_ages: list[int]
    occupancy_type: str
    guest_name: str | None
    guest_contact: str | None
    check_in: date
    check_out: date
    nights: int
    entitlement_nights: DecStr
    additional_paid_nights: DecStr
    deduction_explanation: str
    status: str
    confirmation_number: str | None
    reschedule_count: int
    remarks: str | None
    warnings_overridden: dict[str, Any] | None
    cancellation: dict[str, Any] | None = None
    version: int
    status_history: list[StatusHistoryOut] = []
    date_versions: list[DateVersionOut] = []


class ReservationDetail(BaseModel):
    reservation: ReservationOut
    unpaid_asf_years: list[int]
    asf_charges: list[dict[str, Any]]
    deduction: dict[str, Any] | None
    payments: list[dict[str, Any]]
    documents: list[dict[str, Any]] = []  # vouchers and letters linked to the reservation (voided ones marked)


__all__ = ["Decimal"]
