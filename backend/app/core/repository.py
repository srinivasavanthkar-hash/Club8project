"""Generic repository helpers: paging, sorting (whitelisted), get-or-404."""

import uuid
from collections.abc import Sequence
from typing import Any, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, RuleViolation
from app.core.schemas import PageParams

M = TypeVar("M")


async def get_or_404(
    session: AsyncSession, model: type[M], id_: uuid.UUID, *, for_update: bool = False, label: str | None = None
) -> M:
    stmt = select(model).where(model.id == id_)  # type: ignore[attr-defined]
    if hasattr(model, "deleted_at"):
        stmt = stmt.where(model.deleted_at.is_(None))  # type: ignore[attr-defined]
    if for_update:
        stmt = stmt.with_for_update()
    obj = (await session.execute(stmt)).scalar_one_or_none()
    if obj is None:
        raise NotFound(f"{label or model.__name__} not found")
    return obj


async def paginate(
    session: AsyncSession, stmt: Select[Any], params: PageParams, sortable: dict[str, Any], default_sort: Sequence[Any]
) -> tuple[list[Any], int]:
    total = (await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    if params.sort:
        key = params.sort.lstrip("-")
        if key not in sortable:
            raise RuleViolation(f"Cannot sort by {key}", code="BadSort", extra={"sortable": sorted(sortable)})
        col = sortable[key]
        stmt = stmt.order_by(col.desc() if params.sort.startswith("-") else col.asc())
    else:
        stmt = stmt.order_by(*default_sort)
    rows = (await session.execute(stmt.offset(params.offset).limit(params.page_size))).scalars().all()
    return list(rows), total
