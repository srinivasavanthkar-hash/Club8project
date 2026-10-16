import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.repository import get_or_404, paginate
from app.core.schemas import Page, PageParams
from app.leads import service
from app.leads.models import Lead, LeadStatusHistory
from app.leads.schemas import LeadIn, LeadOut, LeadPatch, NoteIn, NoteOut, StatusHistoryOut, StatusIn

router = APIRouter(route_class=TransactionalRoute, prefix="/leads", tags=["leads"])
SORTABLE = {
    "entry_date": Lead.entry_date,
    "lead_number": Lead.lead_number,
    "prospect_name": Lead.name_norm,
    "status": Lead.status,
    "follow_up_date": Lead.follow_up_date,
}


@router.get("", response_model=Page[LeadOut])
async def list_leads(
    session: SessionDep,
    _: User = Depends(require_permission("lead.view")),
    params: PageParams = Depends(),
    q: str | None = None,
    status: list[str] | None = Query(None),
    venue_id: uuid.UUID | None = None,
    opc: str | None = None,
    salesperson_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    follow_up_due: bool = False,
) -> Page[LeadOut]:
    stmt = service.list_query(
        q=q,
        status=status,
        venue_id=venue_id,
        opc=opc,
        salesperson_id=salesperson_id,
        date_from=date_from,
        date_to=date_to,
        follow_up_due=follow_up_due,
    )
    items, total = await paginate(session, stmt, params, SORTABLE, [Lead.entry_date.desc(), Lead.lead_number.desc()])
    return Page(
        items=[LeadOut.model_validate(i) for i in items], total=total, page=params.page, page_size=params.page_size
    )


@router.post("", response_model=LeadOut, status_code=201)
async def create_lead(
    body: LeadIn, session: SessionDep, user: User = Depends(require_permission("lead.create"))
) -> LeadOut:
    return LeadOut.model_validate(await service.create(session, body, user))


@router.get("/follow-ups")
async def follow_ups(session: SessionDep, _: User = Depends(require_permission("lead.view"))) -> list[dict[str, Any]]:
    return await service.follow_up_dashboard(session)


@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(
    lead_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("lead.view"))
) -> LeadOut:
    return LeadOut.model_validate(await get_or_404(session, Lead, lead_id, label="Lead"))


@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: uuid.UUID, body: LeadPatch, session: SessionDep, user: User = Depends(require_permission("lead.update"))
) -> LeadOut:
    return LeadOut.model_validate(await service.update(session, lead_id, body, user))


@router.post("/{lead_id}/status", response_model=LeadOut)
async def change_status(
    lead_id: uuid.UUID,
    body: StatusIn,
    session: SessionDep,
    user: User = Depends(require_permission("lead.status.change")),
) -> LeadOut:
    return LeadOut.model_validate(await service.change_status(session, lead_id, body, user))


@router.post("/{lead_id}/notes", response_model=NoteOut, status_code=201)
async def add_note(
    lead_id: uuid.UUID, body: NoteIn, session: SessionDep, user: User = Depends(require_permission("lead.update"))
) -> NoteOut:
    return NoteOut.model_validate(await service.add_note(session, lead_id, body.note, user))


@router.get("/{lead_id}/status-history", response_model=list[StatusHistoryOut])
async def status_history(
    lead_id: uuid.UUID, session: SessionDep, _: User = Depends(require_permission("lead.view"))
) -> list[StatusHistoryOut]:
    rows = (
        await session.execute(
            select(LeadStatusHistory).where(LeadStatusHistory.lead_id == lead_id).order_by(LeadStatusHistory.changed_at)
        )
    ).scalars()
    return [StatusHistoryOut.model_validate(r) for r in rows]
