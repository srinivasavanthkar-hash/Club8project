"""Shared Pydantic types."""

from decimal import Decimal
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

T = TypeVar("T")

# Money / nights: Decimal in, string out (never float on the wire)
MoneyIn = Annotated[Decimal, Field(max_digits=14, decimal_places=2, ge=0)]
SignedMoney = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
NightsIn = Annotated[Decimal, Field(max_digits=5, decimal_places=1, ge=0)]
DecStr = Annotated[Decimal, PlainSerializer(lambda v: str(v), return_type=str)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class PageParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(25, ge=1, le=200)
    sort: str | None = None  # "field" or "-field"

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class Warning_(BaseModel):
    code: str
    message: str
