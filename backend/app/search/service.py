"""Global search: membership number (with/without prefix), lead id, applicant names, mobile, email.
Partial and case-insensitive; names use trigram GIN indexes (pg_trgm) for fast ILIKE."""

from typing import Any

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.validators import normalize_phone
from app.leads.models import Lead
from app.members.domain import membership_number_search_forms
from app.members.models import Member, MemberApplicant


def _escape(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def member_search_clause(q: str) -> ColumnElement[bool]:
    q = q.strip()
    full, num = membership_number_search_forms(q)
    like = f"%{_escape(q.lower())}%"
    phone = normalize_phone(q) if any(c.isdigit() for c in q) else None
    conds: list[ColumnElement[bool]] = [
        Member.membership_number.ilike(f"%{_escape(full)}%"),
        Member.membership_seq == num,
        Member.email.ilike(like),
    ]
    sub = [MemberApplicant.name_norm.like(like), MemberApplicant.email.ilike(like)]
    if phone and len(phone) >= 4:
        sub.append(MemberApplicant.mobile.like(f"%{_escape(phone)}%"))
    conds.append(Member.id.in_(select(MemberApplicant.member_id).where(or_(*sub))))
    return or_(*conds)


def lead_search_clause(q: str) -> ColumnElement[bool]:
    q = q.strip()
    like = f"%{_escape(q.lower())}%"
    phone = normalize_phone(q) if any(c.isdigit() for c in q) else None
    conds: list[ColumnElement[bool]] = [
        Lead.lead_number.ilike(f"%{_escape(q)}%"),
        Lead.name_norm.like(like),
        Lead.email.ilike(like),
    ]
    if phone and len(phone) >= 4:
        conds += [Lead.mobile.like(f"%{_escape(phone)}%"), Lead.whatsapp.like(f"%{_escape(phone)}%")]
    return or_(*conds)


async def global_search(
    session: AsyncSession, q: str, perms: set[str], limit: int = 20
) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {"members": [], "leads": []}
    if len(q.strip()) < 2:
        return out
    if "member.view" in perms:
        rows = (
            await session.execute(
                select(Member)
                .where(Member.deleted_at.is_(None), member_search_clause(q))
                .order_by(Member.membership_number)
                .limit(limit)
            )
        ).scalars()
        for m in rows:
            a = [x for x in m.applicants]
            out["members"].append(
                {
                    "id": str(m.id),
                    "membership_number": m.membership_number,
                    "status": m.status,
                    "names": [x.full_name for x in a],
                    "mobile": a[0].mobile if a else None,
                    "email": m.email,
                }
            )
    if "lead.view" in perms:
        rows2 = (
            await session.execute(
                select(Lead)
                .where(Lead.deleted_at.is_(None), lead_search_clause(q))
                .order_by(Lead.entry_date.desc())
                .limit(limit)
            )
        ).scalars()
        for ld in rows2:
            out["leads"].append(
                {
                    "id": str(ld.id),
                    "lead_number": ld.lead_number,
                    "name": ld.prospect_name,
                    "mobile": ld.mobile,
                    "status": ld.status,
                    "member_id": str(ld.member_id) if ld.member_id else None,
                }
            )
    return out
