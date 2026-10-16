import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.schemas import ORM
from app.core.validators import validate_mobile


class LeadIn(BaseModel):
    prospect_name: str = Field(min_length=2, max_length=150)
    mobile: str
    whatsapp: str | None = None
    whatsapp_same_as_mobile: bool = False
    email: EmailStr | None = None
    city: str | None = Field(None, max_length=100)
    venue_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    opc_name: str | None = Field(None, max_length=150)
    salesperson_id: uuid.UUID | None = None
    follow_up_date: date | None = None
    entry_date: date | None = None
    note: str | None = Field(None, max_length=4000)
    duplicate_override_reason: str | None = Field(None, max_length=500)

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v: str) -> str:
        return validate_mobile(v)

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v: str | None) -> str | None:
        return validate_mobile(v) if v else None

    @model_validator(mode="after")
    def _same(self) -> "LeadIn":
        if self.whatsapp_same_as_mobile:
            self.whatsapp = self.mobile
        return self


class LeadPatch(BaseModel):
    prospect_name: str | None = Field(None, min_length=2, max_length=150)
    mobile: str | None = None
    whatsapp: str | None = None
    whatsapp_same_as_mobile: bool | None = None
    email: EmailStr | None = None
    city: str | None = None
    venue_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    opc_name: str | None = None
    salesperson_id: uuid.UUID | None = None
    follow_up_date: date | None = None
    version: int

    @field_validator("mobile", "whatsapp")
    @classmethod
    def _m(cls, v: str | None) -> str | None:
        return validate_mobile(v) if v else v


class StatusIn(BaseModel):
    status: str
    presentation_at: datetime | None = None
    note: str | None = Field(None, max_length=1000)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class NoteOut(ORM):
    id: uuid.UUID
    note: str
    created_at: datetime
    created_by: uuid.UUID | None


class LeadOut(ORM):
    id: uuid.UUID
    lead_number: str
    entry_date: date
    prospect_name: str
    mobile: str
    whatsapp: str | None
    whatsapp_same_as_mobile: bool
    email: str | None
    city: str | None
    venue_id: uuid.UUID | None
    source_id: uuid.UUID | None
    opc_name: str | None
    salesperson_id: uuid.UUID | None
    follow_up_date: date | None
    status: str
    presentation_at: datetime | None
    member_id: uuid.UUID | None
    converted_at: datetime | None
    version: int
    notes: list[NoteOut] = []


class StatusHistoryOut(ORM):
    from_status: str | None
    to_status: str
    changed_at: datetime
    changed_by: uuid.UUID | None
    note: str | None
