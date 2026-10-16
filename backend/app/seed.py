"""Reference-data seed (idempotent). Contains NO prices, fees or rates - those are entered by the client
or, for demos only, by `seed_demo.py` (clearly labelled demo values).

Usage: python -m app.seed [--admin-password ...]
"""

from __future__ import annotations

import argparse
import asyncio
import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import models as m
from app.auth.models import Permission, Role, User
from app.auth.permissions import PERMISSIONS, ROLE_DEFAULTS
from app.core.db import sessionmaker
from app.core.security import hash_password
from app.core.settings_store import DEFAULTS
from app.core.state_machine import LEAD_TRANSITIONS, MEMBER_TRANSITIONS, RESERVATION_TRANSITIONS
from app.correspondence.letters import DEFAULT_TEMPLATES

CODED: dict[type[Any], list[dict[str, Any]]] = {
    m.ResortCategory: [
        {"code": "CLASSIC", "name": "Classic", "sort_order": 1},
        {"code": "PREMIUM", "name": "Premium", "sort_order": 2},
        {"code": "SUPREME", "name": "Supreme", "sort_order": 3},
    ],
    m.Season: [
        {"code": "RED", "name": "Red", "description": "Peak", "priority": 1, "sort_order": 1},
        {"code": "WHITE", "name": "White", "description": "Mid", "priority": 2, "sort_order": 2},
        {"code": "BLUE", "name": "Blue", "description": "Off", "priority": 3, "sort_order": 3},
    ],
    m.UnitType: [
        {
            "code": "T0",
            "name": "Studio",
            "max_adults": 2,
            "max_children": 2,
            "child_age_limit": 10,
            "max_total": 4,
            "occupancy_text": "2 adults + 2 children below 10 years",
        },
        {
            "code": "T1",
            "name": "One-Bedroom",
            "max_adults": 4,
            "max_children": 0,
            "child_age_limit": 10,
            "max_total": 4,
            "occupancy_text": "4 adults",
        },
    ],
    m.PaymentType: [
        {"code": "DOWN_PAYMENT", "name": "Down payment"},
        {"code": "MEMBERSHIP_EMI", "name": "Membership EMI"},
        {"code": "ADMIN_FEE", "name": "Admin fee"},
        {"code": "ASF", "name": "Annual Subscription Fee", "gst_applicable": True, "tax_code": "GST_ASF"},
        {"code": "BOOKING_FEE", "name": "Booking fee", "requires_reservation": True},
        {"code": "UPGRADE_CHARGE", "name": "Upgrade charge", "requires_reservation": True},
        {"code": "ADDITIONAL_NIGHTS", "name": "Additional nights", "requires_reservation": True},
        {"code": "EXTRA", "name": "Extra"},
    ],
    m.PaymentMethod: [
        {"code": "CARD", "name": "Card", "requires_reference": True, "allows_card_last4": True},
        {"code": "CHEQUE", "name": "Cheque", "requires_reference": True, "requires_bank": True},
        {"code": "BANK_TRANSFER", "name": "Bank Transfer / NEFT / RTGS / IMPS", "requires_reference": True},
        {"code": "UPI", "name": "UPI", "requires_reference": True},
        {
            "code": "CASH",
            "name": "Cash (disabled: agreement accepts no cash)",
            "requires_reference": False,
            "is_active": False,
        },
    ],
    m.DocumentType: [
        {"code": "MEMBERSHIP_APPLICATION", "name": "Membership Application Form"},
        {"code": "MEMBERSHIP_AGREEMENT_SIGNED", "name": "Membership Agreement (signed)"},
        {"code": "TERMS_CONDITIONS", "name": "Terms & Conditions"},
        {"code": "KYC_AADHAAR_MASKED", "name": "KYC - Aadhaar (masked copy only)", "is_kyc": True},
        {"code": "KYC_PAN", "name": "KYC - PAN", "is_kyc": True},
        {"code": "KYC_DL", "name": "KYC - Driving Licence", "is_kyc": True},
        {"code": "KYC_PASSPORT", "name": "KYC - Passport", "is_kyc": True},
        {"code": "KYC_VOTER_ID", "name": "KYC - Voter ID", "is_kyc": True},
        {"code": "PAYMENT_RECEIPT", "name": "Payment Receipt"},
        {"code": "BOOKING_CONFIRMATION", "name": "Booking Confirmation"},
        {"code": "VOUCHER", "name": "Voucher"},
        {"code": "DEFAULT_NOTICE", "name": "Default Notice", "is_sensitive": True},
        {"code": "CALL_RECORDING", "name": "Call recording"},
        {"code": "OTHER", "name": "Other"},
    ],
    m.Reason: [
        {"code": "NO_AVAILABILITY", "name": "No availability at property", "kind": "DECLINE"},
        {"code": "OUTSIDE_ENTITLEMENT", "name": "Outside entitlement", "kind": "DECLINE"},
        {"code": "MEMBER_REQUEST", "name": "Member request", "kind": "CANCEL"},
        {"code": "PROPERTY_ISSUE", "name": "Property issue", "kind": "CANCEL"},
        {"code": "CALL_REACHED", "name": "Reached", "kind": "CALL_OUTCOME"},
        {"code": "CALL_NO_ANSWER", "name": "No answer", "kind": "CALL_OUTCOME"},
        {"code": "CALL_CALLBACK", "name": "Call back requested", "kind": "CALL_OUTCOME"},
    ],
    m.JoiningOfferType: [
        {"code": "BONUS_NIGHTS", "name": "Bonus nights", "credits_nights": True},
        {"code": "HOLIDAY_VOUCHER", "name": "Holiday voucher", "credits_nights": False},
        {"code": "OTHER", "name": "Other offer", "credits_nights": False},
    ],
    m.LeadSource: [{"code": "STREET", "name": "Street / venue"}, {"code": "REFERRAL", "name": "Referral"}],
}

CURRENCIES = [
    {"code": "INR", "name": "Indian Rupee", "symbol": "₹"},
    {"code": "USD", "name": "US Dollar", "symbol": "$"},
]


async def _upsert_coded(session: AsyncSession, model: type[Any], rows: list[dict[str, Any]], key: str = "code") -> None:
    for row in rows:
        exists = (await session.execute(select(model).where(getattr(model, key) == row[key]))).scalar_one_or_none()
        if exists is None:
            session.add(model(**row))


async def seed_reference(session: AsyncSession, admin_password: str | None = None) -> None:
    # Permissions and roles
    for code, desc in PERMISSIONS.items():
        if (await session.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none() is None:
            session.add(Permission(code=code, description=desc))
    await session.flush()
    perms = {p.code: p for p in (await session.execute(select(Permission))).scalars()}
    for code, (name, codes) in ROLE_DEFAULTS.items():
        role = (await session.execute(select(Role).where(Role.code == code))).scalar_one_or_none()
        if role is None:
            session.add(Role(code=code, name=name, is_system=True, permissions=[perms[c] for c in sorted(codes)]))
    for model, rows in CODED.items():
        await _upsert_coded(session, model, rows)
    await _upsert_coded(session, m.Currency, CURRENCIES)
    for key, value in DEFAULTS.items():
        await _upsert_coded(
            session,
            m.SystemSetting,
            [{"key": key, "value": value, "description": "See docs/BUSINESS_RULES.md"}],
            key="key",
        )
    for entity, transitions in (
        ("LEAD", LEAD_TRANSITIONS),
        ("MEMBER", MEMBER_TRANSITIONS),
        ("RESERVATION", RESERVATION_TRANSITIONS),
    ):
        for code, nxt in transitions.items():
            ex = (
                await session.execute(
                    select(m.StatusDefinition).where(
                        m.StatusDefinition.entity == entity, m.StatusDefinition.code == code
                    )
                )
            ).first()
            if ex is None:
                session.add(
                    m.StatusDefinition(entity=entity, code=code, label=code.replace("_", " ").title(), allowed_next=nxt)
                )
    for code, body in DEFAULT_TEMPLATES.items():
        await _upsert_coded(
            session, m.LetterTemplate, [{"code": code, "name": code.replace("_", " ").title(), "body_html": body}]
        )
    await session.flush()
    if admin_password:
        admin = (await session.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
        if admin is None:
            role = (await session.execute(select(Role).where(Role.code == "ADMIN"))).scalar_one()
            session.add(
                User(
                    username="admin",
                    full_name="System Administrator",
                    password_hash=hash_password(admin_password),
                    roles=[role],
                    must_change_password=True,
                )
            )
    await session.flush()


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--admin-password", default=os.environ.get("CRM_SEED_ADMIN_PASSWORD"))
    args = p.parse_args()
    async with sessionmaker()() as s:
        await seed_reference(s, args.admin_password)
        await s.commit()
    print("Reference data seeded.")


if __name__ == "__main__":
    asyncio.run(main())
