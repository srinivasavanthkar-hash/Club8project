"""Cancelling a confirmed reservation (docs/DECISIONS.md D-31 to D-34).

The member's written request (an email or an uploaded letter) sets the default notice date; staff may change it with
a reason, never to a future date or to before the booking was confirmed. The cancellation tier then decides the nights
credited back (D-11 to D-13). An unpaid ASF the booking alone needed is withdrawn (D-33), the voucher is marked
cancelled and a cancellation letter is generated (D-34). Nothing is sent to the member or the property automatically.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import CancellationTier, Company, DocumentType, Property
from app.audit import service as audit
from app.auth.models import User
from app.core.money import nights
from app.core.timeutil import IST, fmt_date, now_utc, today_ist
from app.correspondence import letters
from app.correspondence.models import Document, DocumentLink, Email
from app.entitlement import domain as ent
from app.entitlement import service as ent_service
from app.finance import service as fin
from app.finance.models import AsfCharge, ReservationAsfLink
from app.members.models import Member
from app.reservations.models import Reservation


async def tiers_on(session: AsyncSession, on: date) -> tuple[list[ent.CancellationTier], str]:
    rows = list(
        (
            await session.execute(
                select(CancellationTier)
                .where(
                    CancellationTier.effective_from <= on,
                    or_(CancellationTier.effective_to.is_(None), CancellationTier.effective_to >= on),
                )
                .order_by(CancellationTier.min_days.desc())
            )
        ).scalars()
    )
    if not rows:
        return list(ent.DEFAULT_TIERS), "DOWN"
    return [ent.CancellationTier(r.min_days, r.max_days, Decimal(r.credit_percent)) for r in rows], rows[
        0
    ].rounding_mode


def needs_written_request(r: Reservation) -> bool:
    """Tiers and the written-request rule apply to confirmed bookings only (D-13)."""
    return r.status == "CONFIRMED" or (r.status == "RESCHEDULED" and bool(r.confirmation_number))


def confirmed_on(r: Reservation) -> date | None:
    """The day (IST) the booking was first confirmed."""
    days = [h.changed_at.astimezone(IST).date() for h in r.status_history if h.to_status == "CONFIRMED"]
    return min(days) if days else None


@dataclass
class WrittenRequest:
    ref: str
    kind: str  # email | document
    received_on: date  # IST: the email's date, or the day the letter was uploaded
    label: str  # email subject or file name


async def written_request(session: AsyncSession, member_id: uuid.UUID, ref: str | None) -> WrittenRequest | None:
    """The member's email or uploaded letter named by `ref` ("email:<id>" / "document:<id>"), if it belongs to the
    member. Outgoing emails and generated documents (vouchers, receipts) never count as the member's request."""
    if not ref:
        return None
    kind, _, raw = ref.partition(":")
    try:
        oid = uuid.UUID(raw)
    except ValueError:
        return None
    if kind == "email":
        e = await session.get(Email, oid)
        if e is None or e.member_id != member_id or e.deleted_at is not None or e.direction != "INCOMING":
            return None  # only an email from the member is their request
        return WrittenRequest(ref, kind, e.sent_at.astimezone(IST).date(), e.subject)
    if kind == "document":
        d = await session.get(Document, oid)
        if d is None or d.member_id != member_id or d.deleted_at is not None or d.is_generated:
            return None
        return WrittenRequest(ref, kind, d.created_at.astimezone(IST).date(), d.file_name)
    return None


@dataclass
class Terms:
    """What a cancellation would do. `problems` empty means it can go ahead."""

    confirmed: bool
    request: WrittenRequest | None
    confirmed_on: date | None
    default_date: date | None
    cancel_date: date | None
    date_source: str | None  # REQUEST | CONFIRMATION (request dated earlier) | STAFF
    date_reason: str | None
    notice_days: int | None
    tier_percent: str | None
    deducted: str
    credited: str
    forfeited: str
    asf_withdraw_years: list[int]
    problems: list[str] = field(default_factory=list)
    missing_request: bool = False

    @property
    def summary(self) -> str | None:
        """e.g. "20 days' notice → 50%: 2.0 nights credited, 2.0 forfeited"."""
        if not self.confirmed:
            return f"Not yet confirmed → 100%: {self.credited} nights credited, 0.0 forfeited"
        if self.notice_days is None or self.tier_percent is None:
            return None
        n = self.notice_days
        notice = f"{n} day's notice" if n == 1 else f"{n} days' notice" if n >= 0 else f"{-n} day(s) after check-in"
        return f"{notice} → {self.tier_percent}%: {self.credited} nights credited, {self.forfeited} forfeited"

    def as_dict(self) -> dict[str, Any]:
        return {
            "confirmed": self.confirmed,
            "request": (
                {
                    "ref": self.request.ref,
                    "kind": self.request.kind,
                    "received_on": self.request.received_on,
                    "label": self.request.label,
                }
                if self.request
                else None
            ),
            "confirmed_on": self.confirmed_on,
            "default_date": self.default_date,
            "max_date": today_ist(),
            "cancel_date": self.cancel_date,
            "date_source": self.date_source,
            "date_reason": self.date_reason,
            "notice_days": self.notice_days,
            "tier_percent": self.tier_percent,
            "deducted": self.deducted,
            "credited": self.credited,
            "forfeited": self.forfeited,
            "asf_withdraw_years": self.asf_withdraw_years,
            "summary": self.summary,
            "problems": self.problems,
        }


async def terms(
    session: AsyncSession,
    r: Reservation,
    member: Member,
    ref: str | None,
    cancel_date: date | None,
    date_reason: str | None,
) -> Terms:
    """Work out a cancellation without changing anything: shown on screen first, then checked again on submit."""
    d = await ent_service.active_deduction(session, r.id, lock=False)
    asf_years = await fin.withdraw_unpaid_asf(session, r.id, "", None, dry_run=True)
    if not needs_written_request(r):  # not confirmed yet: everything comes back (D-13)
        total = str(nights(sum((Decimal(ln["nights"]) for ln in d.plan["lines"]), Decimal(0)))) if d else "0.0"
        return Terms(False, None, None, None, None, None, None, None, "100", total, total, "0.0", asf_years)

    problems: list[str] = []
    req = await written_request(session, member.id, ref)
    missing = req is None
    if missing:
        problems.append(
            "Cancelling a confirmed reservation requires the member's written request: link the email or "
            "uploaded letter"
            if not ref
            else "The linked email or letter was not found for this member"
        )
    conf = confirmed_on(r)
    today = today_ist()
    default = source = None
    if req is not None:
        default, source = req.received_on, "REQUEST"
        if conf and default < conf:
            default, source = conf, "CONFIRMATION"  # a request dated before the confirmation counts from it
        default = min(default, today)
    chosen = cancel_date or default
    reason = (date_reason or "").strip() or None
    if cancel_date is not None and cancel_date != default:
        source = "STAFF"
        if not reason or len(reason) < 3:
            problems.append("Give a reason for changing the cancellation date")
    if chosen is not None and chosen > today:
        problems.append("The cancellation date cannot be in the future")
    if chosen is not None and conf is not None and chosen < conf:
        problems.append(f"The cancellation date cannot be before the booking was confirmed ({fmt_date(conf)})")

    notice = tier = None
    preview: dict[str, Any] = {"deducted": "0.0", "credited": "0.0", "forfeited": "0.0", "tier_percent": None}
    if chosen is not None:
        tiers, rounding = await tiers_on(session, chosen)
        preview = ent_service.cancellation_preview(d, chosen, r.check_in, tiers, rounding)
        notice, tier = (r.check_in - chosen).days, preview["tier_percent"]
    return Terms(
        True,
        req,
        conf,
        default,
        chosen,
        source,
        reason if source == "STAFF" else None,
        notice,
        tier,
        preview["deducted"],
        preview["credited"],
        preview["forfeited"],
        asf_years,
        problems,
        missing,
    )


async def void_vouchers(session: AsyncSession, r: Reservation, why: str, user: User) -> list[str]:
    """Mark the reservation's vouchers as no longer valid. They are kept (never deleted) and say so on screen."""
    docs = list(
        (
            await session.execute(
                select(Document)
                .join(DocumentLink, DocumentLink.document_id == Document.id)
                .join(DocumentType, DocumentType.id == Document.document_type_id)
                .where(
                    DocumentLink.entity_type == "RESERVATION",
                    DocumentLink.entity_id == r.id,
                    DocumentType.code == "VOUCHER",
                    Document.voided_at.is_(None),
                    Document.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .unique()
    )
    for doc in docs:
        doc.voided_at, doc.void_reason, doc.updated_by = now_utc(), why[:300], user.id
        audit.record(
            session,
            "DOCUMENT_VOIDED",
            f"Voucher {doc.file_name} marked cancelled: {why}",
            entity_type="documents",
            entity_id=doc.id,
            entity_ref=doc.file_name,
            member_id=r.member_id,
        )
    return [str(doc.id) for doc in docs]


async def paid_asf_years(session: AsyncSession, reservation_id: uuid.UUID) -> list[int]:
    rows = (
        await session.execute(
            select(AsfCharge.membership_year)
            .join(ReservationAsfLink, ReservationAsfLink.asf_charge_id == AsfCharge.id)
            .where(ReservationAsfLink.reservation_id == reservation_id, AsfCharge.status == "PAID")
        )
    ).scalars()
    return sorted(set(rows))


async def generate_letter(
    session: AsyncSession,
    r: Reservation,
    member: Member,
    t: Terms,
    *,
    reason_name: str,
    reason_text: str | None,
    asf_withdrawn: list[int],
    voucher_voided: bool,
    user: User,
) -> Document:
    """The cancellation letter (same letterhead as the voucher), saved with the member's documents. Not sent."""
    prop = await session.get(Property, r.property_id)
    company = await session.get(Company, member.company_id)
    return await letters.generate(
        session,
        code="CANCELLATION_LETTER",
        doc_type_code="CANCELLATION_LETTER",
        ctx={
            "company": company,
            "m": member,
            "r": r,
            "name": member.applicants[0].full_name if member.applicants else "",
            "property": prop.name if prop else "",
            "issued_on": today_ist(),
            "c": {
                "request_kind": "email" if t.request and t.request.kind == "email" else "letter",
                "request_received_on": t.request.received_on if t.request else None,
                "cancel_date": t.cancel_date,
                "date_source": t.date_source,
                "date_reason": t.date_reason,
                "confirmed_on": t.confirmed_on,
                "notice_days": t.notice_days,
                "tier_percent": t.tier_percent,
                "deducted": t.deducted,
                "credited": t.credited,
                "forfeited": t.forfeited,
                "reason": reason_name,
                "reason_text": reason_text,
                "asf_withdrawn": asf_withdrawn,
                "asf_paid": await paid_asf_years(session, r.id),
                "voucher_voided": voucher_voided,
            },
        },
        member_id=member.id,
        file_name=f"cancellation-{r.reservation_number}.pdf",
        user=user,
        links=[("RESERVATION", r.id)],
    )
