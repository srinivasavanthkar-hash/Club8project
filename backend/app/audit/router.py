import uuid
from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, and_, cast, or_, select

from app.audit import service
from app.audit.models import ActivityLog
from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.repository import paginate
from app.core.schemas import Page, PageParams
from app.core.timeutil import IST
from app.members.models import Member

router = APIRouter(route_class=TransactionalRoute, prefix="/activity-log", tags=["audit"])


def _out(r: ActivityLog) -> dict[str, Any]:
    return {
        "seq": r.seq,
        "occurred_at": r.occurred_at,
        "user_id": str(r.user_id) if r.user_id else None,
        "username": r.username,
        "action": r.action,
        "entity_type": r.entity_type,
        "entity_id": r.entity_id,
        "entity_ref": r.entity_ref,
        "member_id": str(r.member_id) if r.member_id else None,
        "summary": r.summary,
        "changes": r.changes,
        "ip": r.ip,
        "user_agent": r.user_agent,
    }


def activity_query(
    user_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    action: list[str] | None,
    entity_type: str | None,
    entity_id: str | None,
    member_id: uuid.UUID | None,
) -> Any:
    q = select(ActivityLog)
    if user_id:
        q = q.where(ActivityLog.user_id == user_id)
    if date_from:
        q = q.where(ActivityLog.occurred_at >= datetime.combine(date_from, time.min, IST))
    if date_to:
        q = q.where(ActivityLog.occurred_at < datetime.combine(date_to + timedelta(days=1), time.min, IST))
    if action:
        q = q.where(ActivityLog.action.in_(action))
    if entity_type:
        q = q.where(ActivityLog.entity_type == entity_type)
    if entity_id:
        q = q.where(ActivityLog.entity_id == entity_id)
    if member_id:
        # include the trail of the lead this member was converted from (logged before the member existed)
        lead_id = select(cast(Member.source_lead_id, String)).where(Member.id == member_id).scalar_subquery()
        q = q.where(
            or_(
                ActivityLog.member_id == member_id,
                and_(ActivityLog.entity_type == "leads", ActivityLog.entity_id == lead_id),
            )
        )
    return q


@router.get("", response_model=Page[dict[str, Any]])
async def list_activity(
    session: SessionDep,
    _: User = Depends(require_permission("auditlog.view")),
    params: PageParams = Depends(),
    user_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    action: list[str] | None = Query(None),
    entity_type: str | None = None,
    entity_id: str | None = None,
    member_id: uuid.UUID | None = None,
) -> Page[dict[str, Any]]:
    q = activity_query(user_id, date_from, date_to, action, entity_type, entity_id, member_id)
    items, total = await paginate(
        session, q, params, {"seq": ActivityLog.seq, "occurred_at": ActivityLog.occurred_at}, [ActivityLog.seq.desc()]
    )
    return Page(items=[_out(i) for i in items], total=total, page=params.page, page_size=params.page_size)


@router.post("/verify")
async def verify(session: SessionDep, _: User = Depends(require_permission("auditlog.verify"))) -> dict[str, Any]:
    v = await service.verify_integrity(session)
    service.record(session, "AUDIT_VERIFY", f"Activity log integrity check: {v.message} ({v.checked} entries)")
    return {"ok": v.ok, "checked": v.checked, "first_broken_seq": v.first_broken_seq, "message": v.message}


# There is deliberately no update or delete endpoint for the activity log.
