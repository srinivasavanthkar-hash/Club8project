from typing import Any

from fastapi import APIRouter, Query

from app.core.db import TransactionalRoute
from app.core.deps import CurrentUser, SessionDep
from app.search.service import global_search

router = APIRouter(route_class=TransactionalRoute, tags=["search"])


@router.get("/search")
async def search(
    user: CurrentUser, session: SessionDep, q: str = Query(min_length=1, max_length=100)
) -> dict[str, list[dict[str, Any]]]:
    return await global_search(session, q, user.permission_codes())
