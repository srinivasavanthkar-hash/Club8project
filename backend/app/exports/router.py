"""Management exports to CSV / Excel. Filters mirror the list screens; every export is logged."""

import csv
import io
import uuid
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.audit import service as audit
from app.audit.router import activity_query
from app.auth.models import User
from app.core.db import TransactionalRoute
from app.core.deps import SessionDep, require_permission
from app.core.errors import Forbidden
from app.core.timeutil import today_ist
from app.entitlement import service as ent_service
from app.finance.models import Payment
from app.leads import service as lead_service
from app.members.models import Member
from app.reservations.models import Reservation
from app.search.service import member_search_clause

router = APIRouter(route_class=TransactionalRoute, prefix="/exports", tags=["exports"])
MAX_ROWS = 200_000


def _render(rows: list[dict[str, Any]], fmt: str, name: str) -> Response:
    headers = list(rows[0].keys()) if rows else ["(no rows)"]
    if fmt == "xlsx":
        from openpyxl import Workbook

        wb = Workbook(write_only=True)
        ws = wb.create_sheet(name[:31])
        ws.append(headers)
        for r in rows:
            ws.append([_cell(r.get(h)) for h in headers])
        buf = io.BytesIO()
        wb.save(buf)
        return Response(
            buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{name}-{today_ist()}.xlsx"'},
        )
    sio = io.StringIO()
    w = csv.DictWriter(sio, fieldnames=headers, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({h: _csv_safe(_cell(r.get(h))) for h in headers})
    return Response(
        "﻿" + sio.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}-{today_ist()}.csv"'},
    )


def _cell(v: Any) -> Any:
    if v is None or isinstance(v, (int, str, date)):
        return v if not isinstance(v, date) else v.isoformat()
    return str(v)


def _csv_safe(v: Any) -> Any:
    # Prevent CSV/formula injection when opened in Excel
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _log(session: Any, entity: str, fmt: str, n: int, filters: dict[str, Any]) -> None:
    audit.record(
        session,
        "EXPORT",
        f"Exported {n} {entity} row(s) as {fmt.upper()}",
        entity_type=entity,
        changes={"filters": {k: str(v) for k, v in filters.items() if v not in (None, [], "")}},
    )


Fmt = Literal["csv", "xlsx"]


@router.get("/leads")
async def export_leads(
    session: SessionDep,
    _: User = Depends(require_permission("export.run", "lead.view")),
    fmt: Fmt = "csv",
    q: str | None = None,
    status: list[str] | None = Query(None),
    venue_id: uuid.UUID | None = None,
    salesperson_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    stmt = lead_service.list_query(
        q=q,
        status=status,
        venue_id=venue_id,
        opc=None,
        salesperson_id=salesperson_id,
        date_from=date_from,
        date_to=date_to,
        follow_up_due=False,
    )
    rows = [
        {
            "lead_number": x.lead_number,
            "entry_date": x.entry_date,
            "prospect_name": x.prospect_name,
            "mobile": x.mobile,
            "email": x.email,
            "city": x.city,
            "opc_name": x.opc_name,
            "status": x.status,
            "follow_up_date": x.follow_up_date,
            "member_id": x.member_id,
        }
        for x in (await session.execute(stmt.limit(MAX_ROWS))).scalars()
    ]
    _log(session, "leads", fmt, len(rows), dict(q=q, status=status, date_from=date_from, date_to=date_to))
    return _render(rows, fmt, "leads")


@router.get("/members")
async def export_members(
    session: SessionDep,
    _: User = Depends(require_permission("export.run", "member.view")),
    fmt: Fmt = "csv",
    q: str | None = None,
    status: list[str] | None = Query(None),
) -> Response:
    stmt = select(Member).where(Member.deleted_at.is_(None))
    if q:
        stmt = stmt.where(member_search_clause(q))
    if status:
        stmt = stmt.where(Member.status.in_(status))
    rows = []
    for m in (await session.execute(stmt.limit(MAX_ROWS))).scalars():
        a1 = m.applicants[0] if m.applicants else None
        rows.append(
            {
                "membership_number": m.membership_number,
                "status": m.status,
                "applicant1": a1.full_name if a1 else None,
                "mobile": a1.mobile if a1 else None,
                "email": m.email,
                "city": m.city,
                "purchase_date": m.purchase_date,
                "tenure_years": m.tenure_years,
                "first_year": m.first_year_of_use,
                "last_year": m.last_year_of_use,
                "nights_per_year": m.nights_per_year,
                "currency": m.currency,
                "total_price": m.total_price,
                "balance": m.balance,
                **{f"cf_{k}": v for k, v in (m.custom_fields or {}).items()},
            }
        )
    _log(session, "members", fmt, len(rows), dict(q=q, status=status))
    return _render(rows, fmt, "members")


@router.get("/payments")
async def export_payments(
    session: SessionDep,
    _: User = Depends(require_permission("export.run", "finance.view")),
    fmt: Fmt = "csv",
    date_from: date | None = None,
    date_to: date | None = None,
    payment_type: str | None = None,
    member_id: uuid.UUID | None = None,
) -> Response:
    stmt = select(Payment, Member.membership_number).join(Member, Member.id == Payment.member_id)
    if date_from:
        stmt = stmt.where(Payment.payment_date >= date_from)
    if date_to:
        stmt = stmt.where(Payment.payment_date <= date_to)
    if payment_type:
        stmt = stmt.where(Payment.payment_type_code == payment_type)
    if member_id:
        stmt = stmt.where(Payment.member_id == member_id)
    rows = [
        {
            "receipt_number": p.receipt_number,
            "membership_number": num,
            "payment_date": p.payment_date,
            "type": p.payment_type_code,
            "entry_kind": p.entry_kind,
            "base": p.base_amount,
            "gst_rate": p.gst_rate,
            "gst": p.gst_amount,
            "total": p.total_amount,
            "currency": p.currency,
            "reference": p.transaction_ref or p.cheque_number,
            "forfeited": p.is_forfeited,
        }
        for p, num in (await session.execute(stmt.order_by(Payment.payment_date).limit(MAX_ROWS))).all()
    ]
    _log(session, "payments", fmt, len(rows), dict(date_from=date_from, date_to=date_to, payment_type=payment_type))
    return _render(rows, fmt, "payments")


@router.get("/reservations")
async def export_reservations(
    session: SessionDep,
    _: User = Depends(require_permission("export.run", "reservation.view")),
    fmt: Fmt = "csv",
    status: list[str] | None = Query(None),
    check_in_from: date | None = None,
    check_in_to: date | None = None,
) -> Response:
    stmt = select(Reservation, Member.membership_number).join(Member, Member.id == Reservation.member_id)
    if status:
        stmt = stmt.where(Reservation.status.in_(status))
    if check_in_from:
        stmt = stmt.where(Reservation.check_in >= check_in_from)
    if check_in_to:
        stmt = stmt.where(Reservation.check_in <= check_in_to)
    rows = [
        {
            "reservation_number": r.reservation_number,
            "membership_number": num,
            "status": r.status,
            "check_in": r.check_in,
            "check_out": r.check_out,
            "nights": r.nights,
            "entitlement_nights": r.entitlement_nights,
            "additional_paid_nights": r.additional_paid_nights,
            "season": r.season_code,
            "category": r.resort_category_code,
            "confirmation": r.confirmation_number,
        }
        for r, num in (await session.execute(stmt.limit(MAX_ROWS))).all()
    ]
    _log(session, "reservations", fmt, len(rows), dict(status=status, check_in_from=check_in_from))
    return _render(rows, fmt, "reservations")


@router.get("/entitlement")
async def export_entitlement(
    session: SessionDep,
    _: User = Depends(require_permission("export.run", "entitlement.view")),
    fmt: Fmt = "csv",
    status: list[str] | None = Query(None),
) -> Response:
    stmt = select(Member).where(Member.deleted_at.is_(None))
    if status:
        stmt = stmt.where(Member.status.in_(status))
    rows = []
    today = today_ist()
    for m in (await session.execute(stmt.limit(20_000))).scalars():
        for v in await ent_service.view(session, m, today):
            rows.append(
                {
                    "membership_number": m.membership_number,
                    "year": v.year,
                    "allocated": v.allocated,
                    "bonus": v.bonus,
                    "saved_in": v.saved_in,
                    "used": v.used,
                    "on_hold": v.on_hold,
                    "credited_back": v.credited_back,
                    "expired": v.expired,
                    "borrowed_out": v.borrowed_out,
                    "remaining": v.remaining,
                }
            )
    _log(session, "entitlement", fmt, len(rows), dict(status=status))
    return _render(rows, fmt, "entitlement")


@router.get("/activity-log")
async def export_activity(
    session: SessionDep,
    user: User = Depends(require_permission("export.run")),
    fmt: Fmt = "csv",
    user_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    action: list[str] | None = Query(None),
    entity_type: str | None = None,
    member_id: uuid.UUID | None = None,
) -> Response:
    if "auditlog.view" not in user.permission_codes():
        raise Forbidden("Permission auditlog.view is required", code="PermissionDenied")
    q = activity_query(user_id, date_from, date_to, action, entity_type, None, member_id)
    rows = [
        {
            "seq": r.seq,
            "occurred_at": r.occurred_at,
            "username": r.username,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_ref": r.entity_ref,
            "summary": r.summary,
            "changes": r.changes,
            "ip": r.ip,
            "hash": r.hash,
        }
        for r in (await session.execute(q.order_by("seq").limit(MAX_ROWS))).scalars()
    ]
    _log(session, "activity_log", fmt, len(rows), dict(user_id=user_id, date_from=date_from, action=action))
    return _render(rows, fmt, "activity-log")
