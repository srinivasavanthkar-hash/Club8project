"""DB side of duplicate prevention: fetch candidate records by normalised keys, score with the pure domain."""

from __future__ import annotations

from datetime import date

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import lookup_hash
from app.core.errors import Conflict, OverrideRequired
from app.core.validators import normalize_email, normalize_name, normalize_phone
from app.leads.models import Lead
from app.members.domain import DuplicateMatch, PersonKey, find_duplicates
from app.members.models import ApplicantKyc, Member, MemberApplicant


async def check(
    session: AsyncSession,
    *,
    names_dobs: list[tuple[str, date | None]],
    mobiles: list[str],
    email: str | None,
    pans: list[str],
    membership_number: str | None = None,
    exclude_lead_id: object = None,
    exclude_member_id: object = None,
) -> list[DuplicateMatch]:
    mob = [m for m in (normalize_phone(x) for x in mobiles if x) if m]
    em = normalize_email(email)
    names = [normalize_name(n) for n, _ in names_dobs if n]
    pan_hashes = [lookup_hash(p) for p in pans if p]
    existing: list[PersonKey] = []

    lead_conds: list[ColumnElement[bool]] = []
    if mob:
        lead_conds += [Lead.mobile.in_(mob), Lead.whatsapp.in_(mob)]
    if em:
        lead_conds.append(Lead.email == em)
    if lead_conds:
        q = select(Lead).where(Lead.deleted_at.is_(None), or_(*lead_conds), Lead.status != "CONVERTED")
        if exclude_lead_id is not None:
            q = q.where(Lead.id != exclude_lead_id)
        for ld in (await session.execute(q.limit(50))).scalars():
            existing.append(
                PersonKey(
                    ld.lead_number,
                    "LEAD",
                    ld.prospect_name,
                    None,
                    tuple(x for x in (ld.mobile, ld.whatsapp) if x),
                    ld.email,
                )
            )

    app_conds: list[ColumnElement[bool]] = []
    if mob:
        app_conds.append(MemberApplicant.mobile.in_(mob))
    if em:
        app_conds += [MemberApplicant.email == em, Member.email == em]
    if names:
        app_conds.append(MemberApplicant.name_norm.in_(names))
    if pan_hashes:
        app_conds.append(
            MemberApplicant.id.in_(
                select(ApplicantKyc.applicant_id).where(
                    ApplicantKyc.id_type == "PAN", ApplicantKyc.lookup_hash.in_(pan_hashes)
                )
            )
        )
    if membership_number:
        app_conds.append(Member.membership_number == membership_number.upper())
    if app_conds:
        mq = (
            select(Member, MemberApplicant)
            .join(MemberApplicant, MemberApplicant.member_id == Member.id)
            .where(Member.deleted_at.is_(None), or_(*app_conds))
        )
        if exclude_member_id is not None:
            mq = mq.where(Member.id != exclude_member_id)
        for mem, ap in (await session.execute(mq.limit(50))).all():
            pan_match = None
            if pan_hashes:
                for k in ap.kyc:
                    if k.id_type == "PAN" and k.lookup_hash in pan_hashes and k.deleted_at is None:
                        pan_match = next(p for p in pans if lookup_hash(p) == k.lookup_hash)
            existing.append(
                PersonKey(
                    mem.membership_number,
                    "MEMBER",
                    ap.full_name,
                    ap.dob,
                    tuple(x for x in (ap.mobile,) if x),
                    ap.email or mem.email,
                    pan_match,
                    mem.membership_number,
                )
            )

    matches: dict[str, DuplicateMatch] = {}
    for name, dob in names_dobs or [(None, None)]:  # type: ignore[list-item]
        cand = PersonKey("candidate", "NEW", name, dob, tuple(mob), em, pans[0] if pans else None, membership_number)
        for mt in find_duplicates(cand, existing):
            prev = matches.get(mt.ref)
            if prev is None or len(mt.reasons) > len(prev.reasons):
                matches[mt.ref] = mt
    return list(matches.values())


def enforce(matches: list[DuplicateMatch], override_reason: str | None, can_override: bool) -> str | None:
    """Hard-block exact membership-number duplicates; probable duplicates need an override reason."""
    hard = [m for m in matches if m.hard]
    if hard:
        raise Conflict(
            "Membership number already exists",
            code="DuplicateMembershipNumber",
            extra={"matches": [m.ref for m in hard]},
        )
    if matches and not override_reason:
        raise OverrideRequired(
            "Probable duplicate found. Review the matches or save with an override reason.",
            code="ProbableDuplicate",
            extra={"matches": [{"ref": m.ref, "kind": m.kind, "reasons": list(m.reasons)} for m in matches]},
        )
    if matches and not can_override:
        raise OverrideRequired(
            "You do not have permission to override duplicate warnings", code="DuplicateOverrideDenied"
        )
    return override_reason if matches else None
