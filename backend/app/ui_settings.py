"""Display preferences every signed-in user needs (Admin -> Master data -> Business-rule settings, keys "ui.*")."""

from typing import Any

from fastapi import APIRouter

from app.core.db import TransactionalRoute
from app.core.deps import CurrentUser, SessionDep
from app.core.settings_store import get_settings_map

router = APIRouter(route_class=TransactionalRoute, tags=["ui"])


@router.get("/ui-settings")
async def ui_settings(_: CurrentUser, session: SessionDep) -> dict[str, Any]:
    s = await get_settings_map(session, ["ui.week_start"])
    return {"week_start": s["ui.week_start"]}
