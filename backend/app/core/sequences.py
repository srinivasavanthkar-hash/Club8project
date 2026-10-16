"""Gap-free human-readable numbers using a row-locked counter table."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import Sequence_


async def next_value(session: AsyncSession, key: str) -> int:
    await session.execute(insert(Sequence_).values(key=key, next_value=1).on_conflict_do_nothing())
    row = (await session.execute(select(Sequence_).where(Sequence_.key == key).with_for_update())).scalar_one()
    value = row.next_value
    row.next_value = value + 1
    await session.flush()
    return value


async def lead_number(session: AsyncSession, year: int) -> str:
    return f"L-{year}-{await next_value(session, f'lead:{year}'):06d}"


async def reservation_number(session: AsyncSession, year: int) -> str:
    return f"R-{year}-{await next_value(session, f'reservation:{year}'):06d}"


async def receipt_number(session: AsyncSession, company_code: str, receipt_prefix: str, year: int) -> str:
    # per company, per financial-calendar year (OPEN_QUESTIONS #16: per company vs shared)
    return f"{receipt_prefix}-{year}-{await next_value(session, f'receipt:{company_code}:{year}'):06d}"
