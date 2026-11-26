"""Member application, lead conversion, approval, KYC and profile edits."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import Company, DocumentType, MembershipNumberSeries, PaymentMethod, ProductCustomField
from app.audit import service as audit
from app.auth.models import User
from app.core.crypto import decrypt_field, encrypt_field, lookup_hash
from app.core.errors import Conflict, Forbidden, NotFound, RuleViolation
from app.core.repository import get_or_404
from app.core.settings_store import get_settings_map
from app.core.timeutil import fmt_date, now_utc, today_ist
from app.core.validators import (
    mask_aadhaar,
    mask_value,
    normalize_email,
    normalize_name,
    validate_aadhaar,
    validate_adult,
    validate_pan,
)
from app.correspondence.models import Document
from app.entitlement import service as ent_service
from app.finance import service as fin
from app.finance.models import Payment
from app.finance.schemas import PaymentIn
from app.leads import service as lead_service
from app.leads.models import Lead
from app.members import domain, duplicates
from app.members.models import ApplicantKyc, JoiningOffer, Member, MemberApplicant, MemberStatusHistory
from app.members.schemas import ApplicantIn, KycIn, MemberIn, MemberPatch
from app.members.status import set_status


def _kyc_row(k: KycIn, aadhaar_full: bool) -> ApplicantKyc:
    try:
        return _kyc_row_unchecked(k, aadhaar_full)
    except ValueError as e:
        raise RuleViolation(f"{k.id_type}: {e}", code="KycInvalid") from e


def _kyc_row_unchecked(k: KycIn, aadhaar_full: bool) -> ApplicantKyc:
    if k.id_type == "AADHAAR":
        digits = validate_aadhaar(k.value)  # validate before masking
        return ApplicantKyc(
            id_type="AADHAAR",
            masked=mask_aadhaar(digits),
            value_encrypted=encrypt_field(digits) if aadhaar_full else None,
            lookup_hash=lookup_hash(digits),
            document_id=k.document_id,
        )
    value = validate_pan(k.value) if k.id_type == "PAN" else k.value.strip().upper()
    if k.id_type == "PASSPORT" and k.expiry_date is None:
        raise RuleViolation("Passport expiry date is required", code="PassportExpiry")
    return ApplicantKyc(
        id_type=k.id_type,
        masked=mask_value(value),
        value_encrypted=encrypt_field(value),
        lookup_hash=lookup_hash(value),
        expiry_date=k.expiry_date,
        document_id=k.document_id,
    )


async def _validate_custom_fields(
    session: AsyncSession, product_id: uuid.UUID | None, values: dict[str, Any]
) -> dict[str, Any]:
    q = select(ProductCustomField).where(ProductCustomField.is_active.is_(True))
    q = (
        q.where((ProductCustomField.product_id == product_id) | ProductCustomField.product_id.is_(None))
        if product_id
        else q.where(ProductCustomField.product_id.is_(None))
    )
    defs = {d.field_key: d for d in (await session.execute(q)).scalars()}
    unknown = set(values) - set(defs)
    if unknown:
        raise RuleViolation(f"Unknown custom field(s): {sorted(unknown)}", code="CustomFieldUnknown")
    out: dict[str, Any] = {}
    for key, d in defs.items():
        v = values.get(key)
        if v in (None, ""):
            if d.required:
                raise RuleViolation(f"Custom field '{d.label}' is required", code="CustomFieldRequired")
            continue
        try:
            if d.field_type == "number":
                v = str(Decimal(str(v)))
            elif d.field_type == "date":
                v = date.fromisoformat(str(v)).isoformat()
            elif d.field_type == "bool":
                v = bool(v)
            elif d.field_type == "select" and v not in (d.options or []):
                raise ValueError
            else:
                v = str(v)[:1000]
        except (ValueError, ArithmeticError) as e:
            raise RuleViolation(f"Invalid value for custom field '{d.label}'", code="CustomFieldInvalid") from e
        out[key] = v
    return out


def _pan(raw: str) -> str:
    try:
        return validate_pan(raw)
    except ValueError as e:
        raise RuleViolation(f"PAN: {e}", code="KycInvalid") from e


def _check_applicant(a: ApplicantIn, min_age: int, min_ids: int, label: str) -> None:
    try:
        validate_adult(a.dob, today_ist(), min_age)
    except ValueError as e:
        raise RuleViolation(f"{label}: {e}", code="ApplicantAge") from e
    if len(a.kyc) < min_ids:
        raise RuleViolation(f"{label}: at least {min_ids} KYC identifier(s) required", code="KycRequired")
    types = [k.id_type for k in a.kyc]
    if len(types) != len(set(types)):
        raise RuleViolation(f"{label}: duplicate KYC type", code="KycDuplicate")


def _specificity(s: MembershipNumberSeries) -> int:
    return (s.venue_id is not None) + (s.property_id is not None)


async def fitting_series(
    session: AsyncSession,
    company_id: uuid.UUID,
    venue_id: uuid.UUID | None,
    property_id: uuid.UUID | None,
    on: date,
) -> list[MembershipNumberSeries]:
    """Series of this company active on `on` whose sales venue and property fit (a blank one fits any), most
    specific first (docs/DECISIONS.md D-MN-1)."""
    S = MembershipNumberSeries
    rows = (
        await session.execute(
            select(S).where(
                S.company_id == company_id,
                S.active_from <= on,
                or_(S.active_to.is_(None), S.active_to >= on),
                or_(S.venue_id.is_(None), S.venue_id == venue_id) if venue_id else S.venue_id.is_(None),
                or_(S.property_id.is_(None), S.property_id == property_id) if property_id else S.property_id.is_(None),
            )
        )
    ).scalars()
    return sorted(rows, key=lambda s: (-_specificity(s), s.prefix))


def default_series(fits: list[MembershipNumberSeries]) -> MembershipNumberSeries | None:
    """The one most specific series, or None when none fits or two are equally specific."""
    if not fits:
        return None
    best = [s for s in fits if _specificity(s) == _specificity(fits[0])]
    return best[0] if len(best) == 1 else None


async def _choose_series(
    session: AsyncSession,
    company: Company,
    venue_id: uuid.UUID | None,
    property_id: uuid.UUID | None,
    on: date,
    requested: uuid.UUID | None,
) -> MembershipNumberSeries:
    fits = await fitting_series(session, company.id, venue_id, property_id, on)
    if requested is not None:
        chosen = next((s for s in fits if s.id == requested), None)
        if chosen is None:
            raise RuleViolation(
                "The chosen membership number series does not apply to this company, sales venue, property and "
                f"purchase date ({fmt_date(on)}).",
                code="NumberSeriesNotApplicable",
            )
        return chosen
    if not fits:
        raise RuleViolation(
            f"No membership number series applies to {company.name} on {fmt_date(on)}. An administrator can add "
            "one in Admin > Master data > Membership number series.",
            code="NoNumberSeries",
        )
    chosen = default_series(fits)
    if chosen is None:
        raise RuleViolation(
            f"More than one membership number series applies: choose one ({', '.join(s.prefix for s in fits)}).",
            code="ChooseNumberSeries",
        )
    return chosen


async def _membership_number(
    session: AsyncSession, series: MembershipNumberSeries, manual: str | None
) -> tuple[str, str]:
    """ "{prefix}-{number}". A typed number part (paper members) is used as given (the duplicate check follows);
    otherwise the series' next free number, with the series row locked so two saves never get the same number."""
    if manual:
        seq = manual.lstrip("0") or "0"
        return f"{series.prefix}-{seq}".upper(), seq
    S = MembershipNumberSeries
    locked = (
        await session.execute(
            # populate_existing: the series was read before the lock; take the locked row's current counter
            select(S).where(S.id == series.id).with_for_update().execution_options(populate_existing=True)
        )
    ).scalar_one()
    while True:
        seq = str(locked.next_number)
        locked.next_number += 1
        taken = (
            await session.execute(select(Member.id).where(Member.membership_number == f"{locked.prefix}-{seq}"))
        ).first()
        if not taken:
            return f"{locked.prefix}-{seq}".upper(), seq


async def create(session: AsyncSession, data: MemberIn, user: User, *, from_lead: Lead | None = None) -> Member:
    s = await get_settings_map(
        session, ["member.min_applicant_age", "member.min_kyc_ids_per_applicant", "kyc.aadhaar_full_storage"]
    )
    min_age, min_ids = int(s["member.min_applicant_age"]), int(s["member.min_kyc_ids_per_applicant"])
    _check_applicant(data.applicant1, min_age, min_ids, "Applicant 1")
    if data.applicant2:
        _check_applicant(data.applicant2, min_age, min_ids, "Applicant 2")
    company = await get_or_404(session, Company, data.company_id, label="Company")
    prices = domain.price_summary(data.purchase_price, data.admin_fees, data.down_payment_amount)
    domain.balance_mode_check(
        prices.balance,
        data.balance_mode,
        data.emi_amount,
        data.emi_count,
        (data.emi_start_year, data.emi_start_month) if data.emi_start_year and data.emi_start_month else None,
    )
    last_year = domain.last_year_of_use(data.first_year_of_use, data.tenure_years)
    if data.last_year_of_use is not None and data.last_year_of_use != last_year:
        if not data.last_year_override_reason:
            raise RuleViolation(
                f"Last year of use differs from the calculated {last_year}; give a reason", code="LastYearReason"
            )
        if data.last_year_of_use < data.first_year_of_use:
            raise RuleViolation("Last year cannot be before the first year", code="LastYear")
        last_year = data.last_year_of_use
    venue_id = from_lead.venue_id if from_lead else data.venue_id
    series = await _choose_series(
        session, company, venue_id, data.home_property_id, data.purchase_date, data.number_series_id
    )
    number, seq = await _membership_number(session, series, data.membership_number)
    applicants = [data.applicant1] + ([data.applicant2] if data.applicant2 else [])
    pans = [k.value for a in applicants for k in a.kyc if k.id_type == "PAN"]
    matches = await duplicates.check(
        session,
        names_dobs=[(a.full_name, a.dob) for a in applicants],
        mobiles=[a.mobile for a in applicants if a.mobile],
        email=data.email,
        pans=[_pan(p) for p in pans],
        membership_number=number,
        exclude_lead_id=from_lead.id if from_lead else None,
    )
    override = duplicates.enforce(
        matches, data.duplicate_override_reason, "member.duplicate_override" in user.permission_codes()
    )
    custom = await _validate_custom_fields(session, data.product_id, data.custom_fields)

    m = Member(
        company_id=company.id,
        product_id=data.product_id,
        membership_number=number,
        membership_seq=seq,
        number_series_id=series.id,
        home_property_id=data.home_property_id,
        status="PENDING_APPROVAL",
        email=normalize_email(data.email),
        address_line1=data.address.line1,
        address_line2=data.address.line2,
        city=data.address.city,
        postcode=data.address.postcode,
        state=data.address.state,
        country=data.address.country,
        purchase_date=data.purchase_date,
        tenure_years=data.tenure_years,
        first_year_of_use=data.first_year_of_use,
        last_year_of_use=last_year,
        last_year_override_reason=data.last_year_override_reason if data.last_year_of_use else None,
        resort_category_id=data.resort_category_id,
        season_id=data.season_id,
        unit_type_id=data.unit_type_id,
        nights_per_year=data.nights_per_year,
        currency=data.currency,
        purchase_price=prices.purchase_price,
        admin_fees=prices.admin_fees,
        total_price=prices.total_price,
        down_payment_amount=prices.down_payment,
        down_payment_method_id=data.down_payment_method_id,
        balance=prices.balance,
        balance_mode=data.balance_mode,
        emi_amount=data.emi_amount,
        emi_count=data.emi_count,
        emi_start_month=data.emi_start_month,
        emi_start_year=data.emi_start_year,
        instalment_start_date=data.instalment_start_date,
        balance_other_text=data.balance_other_text,
        relationship_manager_id=data.relationship_manager_id,
        team_manager_id=data.team_manager_id,
        comments=data.comments,
        agreement_signed_applicant1=data.agreement_signed_applicant1,
        agreement_signed_applicant2=data.agreement_signed_applicant2,
        agreement_signed_company=data.agreement_signed_company,
        agreement_signed_date=data.agreement_signed_date,
        source_lead_id=from_lead.id if from_lead else data.source_lead_id,
        opc_name=from_lead.opc_name if from_lead else data.opc_name,
        venue_id=venue_id,
        custom_fields=custom,
        duplicate_override_reason=override,
        created_by=user.id,
        updated_by=user.id,
    )
    session.add(m)
    await session.flush()
    for pos, a in enumerate(applicants, start=1):
        ap = MemberApplicant(
            member_id=m.id,
            position=pos,
            full_name=a.full_name.strip(),
            name_norm=normalize_name(a.full_name),
            dob=a.dob,
            mobile=a.mobile,
            email=normalize_email(a.email),
            created_by=user.id,
        )
        session.add(ap)
        await session.flush()
        for k in a.kyc:
            row = _kyc_row(k, bool(s["kyc.aadhaar_full_storage"]))
            row.applicant_id = ap.id
            session.add(row)
    for o in data.joining_offers:
        session.add(
            JoiningOffer(
                member_id=m.id,
                offer_type_id=o.offer_type_id,
                description=o.description,
                nights=o.nights,
                value=o.value,
                valid_until=o.valid_until,
                credit_year=o.credit_year,
            )
        )
    session.add(MemberStatusHistory(member_id=m.id, from_status=None, to_status="PENDING_APPROVAL", changed_by=user.id))
    await session.flush()
    await session.refresh(m, ["applicants", "joining_offers"])
    for ap in m.applicants:
        await session.refresh(ap, ["kyc"])
    if override:
        audit.record(
            session,
            "DUPLICATE_OVERRIDE",
            f"Member {number} saved despite probable duplicate: {override}",
            entity_type="members",
            entity_id=m.id,
            entity_ref=number,
            member_id=m.id,
            changes={"matches": [x.ref for x in matches]},
        )
    if data.down_payment and prices.down_payment > 0:
        if data.down_payment_method_id is None:
            raise RuleViolation("Down payment method is required", code="DownPaymentMethod")
        dp = data.down_payment
        await fin.record_payment(
            session,
            m.id,
            PaymentIn(
                payment_type_code="DOWN_PAYMENT",
                base_amount=prices.down_payment,
                currency=data.currency,
                payment_date=dp.payment_date,
                payment_method_id=data.down_payment_method_id,
                transaction_ref=dp.transaction_ref,
                cheque_number=dp.cheque_number,
                bank_name=dp.bank_name,
                card_last4=dp.card_last4,
                remarks="Down payment recorded with the membership application",
            ),
            user,
        )
    return m


async def convert_lead(session: AsyncSession, lead_id: uuid.UUID, data: MemberIn, user: User) -> Member:
    """Single transaction: create member, mark lead CONVERTED, link both ways. The lead row is retained."""
    lead = await get_or_404(session, Lead, lead_id, for_update=True, label="Lead")
    if lead.status != "ATTENDED":
        raise RuleViolation(f"Only ATTENDED leads can be converted (status {lead.status})", code="LeadNotAttended")
    if lead.member_id is not None:
        raise Conflict("Lead already converted", code="LeadConverted")
    member = await create(session, data, user, from_lead=lead)
    lead_service.mark_converted(lead, member.id, user, session)
    audit.record(
        session,
        "LEAD_CONVERTED",
        f"Lead {lead.lead_number} converted to member {member.membership_number}",
        entity_type="leads",
        entity_id=lead.id,
        entity_ref=lead.lead_number,
        member_id=member.id,
    )
    await session.flush()
    return member


def prefill_from_lead(lead: Lead) -> dict[str, Any]:
    return {
        "applicant1": {"full_name": lead.prospect_name, "mobile": lead.mobile, "email": lead.email},
        "email": lead.email,
        "address": {"city": lead.city},
        "relationship_manager_id": lead.salesperson_id,
        "source_lead_id": lead.id,
        "opc_name": lead.opc_name,
        "venue_id": lead.venue_id,
    }


async def approval_blockers(session: AsyncSession, member: Member) -> list[str]:
    s = await get_settings_map(session, ["member.require_signed_agreement", "member.min_kyc_ids_per_applicant"])
    missing = [
        f
        for f in (
            "purchase_date",
            "tenure_years",
            "first_year_of_use",
            "resort_category_id",
            "season_id",
            "unit_type_id",
            "nights_per_year",
            "address_line1",
            "city",
            "email",
        )
        if getattr(member, f) in (None, "")
    ]
    if not member.applicants:
        missing.append("applicant1")
    if member.balance_mode == "EMI" and not (member.emi_amount and member.emi_count and member.emi_start_year):
        missing.append("EMI details")
    down = (
        await session.execute(
            select(Payment.id).where(
                Payment.member_id == member.id,
                Payment.payment_type_code == "DOWN_PAYMENT",
                Payment.entry_kind == "NORMAL",
                Payment.deleted_at.is_(None),
            )
        )
    ).first()
    agreement = (
        await session.execute(
            select(Document.id)
            .join(DocumentType, DocumentType.id == Document.document_type_id)
            .where(
                Document.member_id == member.id,
                Document.deleted_at.is_(None),
                DocumentType.code == "MEMBERSHIP_AGREEMENT_SIGNED",
            )
        )
    ).first()
    min_ids = int(s["member.min_kyc_ids_per_applicant"])
    kyc_ok = all(len([k for k in a.kyc if k.deleted_at is None]) >= min_ids for a in member.applicants)
    return domain.activation_blockers(
        missing_fields=missing,
        down_payment_recorded=down is not None or member.down_payment_amount == 0,
        signed_agreement_uploaded=agreement is not None,
        require_signed_agreement=bool(s["member.require_signed_agreement"]),
        kyc_ok=kyc_ok,
    )


async def approve(session: AsyncSession, member_id: uuid.UUID, user: User, comments: str | None) -> Member:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    if member.status != "PENDING_APPROVAL":
        raise RuleViolation(f"Member is {member.status}, not pending approval", code="NotPending")
    blockers = await approval_blockers(session, member)
    if blockers:
        raise RuleViolation(
            "Cannot activate: " + "; ".join(blockers), code="ActivationBlocked", extra={"blockers": blockers}
        )
    member.approved_by, member.approved_at = user.id, now_utc()
    if comments:
        member.comments = ((member.comments + "\n") if member.comments else "") + comments
    set_status(session, member, "ACTIVE", user, "Approved")
    await ent_service.seed_member(session, member, user)
    audit.record(
        session,
        "MEMBER_APPROVED",
        f"Member {member.membership_number} approved",
        entity_type="members",
        entity_id=member.id,
        entity_ref=member.membership_number,
        member_id=member.id,
    )
    await session.flush()
    return member


async def update(session: AsyncSession, member_id: uuid.UUID, data: MemberPatch, user: User) -> Member:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    if member.version != data.version:
        raise Conflict("Member was modified by someone else. Reload and retry.", code="VersionConflict")
    if member.status == "TERMINATED":
        raise RuleViolation("Terminated memberships are read-only", code="Terminated")
    session.info["reason"] = data.reason
    if data.email:
        member.email = normalize_email(data.email)  # type: ignore[assignment]
    if data.address:
        a = data.address
        member.address_line1, member.address_line2, member.city = a.line1, a.line2, a.city
        member.postcode, member.state, member.country = a.postcode, a.state, a.country
    for f in (
        "relationship_manager_id",
        "team_manager_id",
        "comments",
        "agreement_signed_applicant1",
        "agreement_signed_applicant2",
        "agreement_signed_company",
        "agreement_signed_date",
        "home_property_id",
    ):
        if f in data.model_fields_set:
            setattr(member, f, getattr(data, f))
    if data.last_year_of_use is not None and data.last_year_of_use != member.last_year_of_use:
        if not data.reason:
            raise RuleViolation("A reason is required to change the last year of use", code="ReasonRequired")
        if member.status != "PENDING_APPROVAL":
            raise RuleViolation(
                "Last year of use can only change before approval (entitlement already seeded)",
                code="EntitlementSeeded",
            )
        member.last_year_of_use = data.last_year_of_use
        member.last_year_override_reason = data.reason
    if data.custom_fields is not None:
        member.custom_fields = await _validate_custom_fields(
            session, member.product_id, {**member.custom_fields, **data.custom_fields}
        )
    s = await get_settings_map(session, ["member.min_applicant_age", "kyc.aadhaar_full_storage"])
    for pos, ap_in in ((1, data.applicant1), (2, data.applicant2)):
        if ap_in is None:
            continue
        try:
            validate_adult(ap_in.dob, today_ist(), int(s["member.min_applicant_age"]))
        except ValueError as e:
            raise RuleViolation(f"Applicant {pos}: {e}", code="ApplicantAge") from e
        ap = next((x for x in member.applicants if x.position == pos), None)
        if ap is None:
            ap = MemberApplicant(member_id=member.id, position=pos, created_by=user.id)
            session.add(ap)
        ap.full_name, ap.name_norm, ap.dob = ap_in.full_name.strip(), normalize_name(ap_in.full_name), ap_in.dob
        ap.mobile, ap.email = ap_in.mobile, normalize_email(ap_in.email)
        await session.flush()
        existing = {k.id_type: k for k in ap.kyc if k.deleted_at is None}
        for k in ap_in.kyc:
            new = _kyc_row(k, bool(s["kyc.aadhaar_full_storage"]))
            old = existing.get(k.id_type)
            if old is not None and old.lookup_hash == new.lookup_hash:
                if k.document_id:
                    old.document_id = k.document_id
                continue
            if old is not None:
                old.deleted_at, old.deleted_by, old.deleted_reason = now_utc(), user.id, data.reason or "Replaced"
            new.applicant_id = ap.id
            session.add(new)
    member.updated_by = user.id
    await session.flush()
    await session.refresh(member, ["applicants"])
    for ap in member.applicants:
        await session.refresh(ap, ["kyc"])
    return member


async def reveal_kyc(session: AsyncSession, kyc_id: uuid.UUID, user: User) -> tuple[str, str]:
    if "kyc.view_full" not in user.permission_codes():
        raise Forbidden("Permission kyc.view_full is required", code="PermissionDenied")
    k = await session.get(ApplicantKyc, kyc_id)
    if k is None or k.deleted_at is not None:
        raise NotFound("KYC record not found")
    if k.value_encrypted is None:
        raise RuleViolation("Only the masked value is stored for this ID", code="MaskedOnly")
    ap = await session.get(MemberApplicant, k.applicant_id)
    audit.record(
        session,
        "KYC_VIEW",
        f"Full {k.id_type} viewed for applicant {ap.full_name if ap else ''}",
        entity_type="applicant_kyc",
        entity_id=k.id,
        member_id=ap.member_id if ap else None,
    )
    return k.id_type, decrypt_field(k.value_encrypted)


async def change_status(session: AsyncSession, member_id: uuid.UUID, to: str, reason: str, user: User) -> Member:
    member = await get_or_404(session, Member, member_id, for_update=True, label="Member")
    set_status(session, member, to, user, reason)
    return member


async def down_payment_method(session: AsyncSession, method_id: uuid.UUID | None) -> PaymentMethod | None:
    return await session.get(PaymentMethod, method_id) if method_id else None
