"""DEMO DATA ONLY - fictitious companies' addresses, users, properties and rates.

All monetary figures here are labelled DEMO and exist only so the demo can run end to end. They are
not client prices. Production rates are entered by management in the admin screens.

Usage: python -m app.seed_demo
"""

from __future__ import annotations

import asyncio
import os
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import models as m
from app.auth.models import Role, User
from app.core.db import sessionmaker
from app.core.security import hash_password
from app.seed import seed_reference

DEMO_PASSWORD = os.environ.get("CRM_DEMO_PASSWORD", "Demo-Passw0rd!")
# demo.admin signs in with two-step verification. FICTITIOUS authenticator key (base32), for demos and tests only:
# add it to any authenticator app ("Enter a set-up key") to get the codes. Never used outside DEMO data.
DEMO_ADMIN_TOTP_SECRET = os.environ.get("CRM_DEMO_TOTP_SECRET", "DEMOADMINTWOFACTORKEY234")
DEMO_TOTP_USERS = {"demo.admin": DEMO_ADMIN_TOTP_SECRET}
DEMO_USERS = [
    ("demo.admin", "Demo Admin", ["ADMIN"]),
    ("demo.manager", "Demo Manager", ["MANAGEMENT"]),
    ("demo.marketing", "Demo Marketer", ["MARKETING"]),
    ("demo.sales", "Demo Salesperson", ["SALES"]),
    ("demo.team", "Demo Team Manager", ["SALES"]),
    ("demo.finance", "Demo Finance", ["FINANCE"]),
    ("demo.reservations", "Demo Reservations", ["RESERVATIONS"]),
    ("demo.service", "Demo Member Services", ["MEMBER_SERVICES"]),
]


async def _get_or_add(session: AsyncSession, model: type, key: str, value: object, **fields: object) -> Any:
    obj = (await session.execute(select(model).where(getattr(model, key) == value))).scalar_one_or_none()
    if obj is None:
        obj = model(**{key: value}, **fields)
        session.add(obj)
        await session.flush()
    return obj


async def _seed_number_series(session: AsyncSession, club8: m.Company, k8: m.Company) -> None:
    """FICTITIOUS membership number series. Club8 has said prefixes depend on location and property; the prefixes
    below were seen on their forms, but which location or property each belongs to is not known yet, so every series
    is marked "to be confirmed" (docs/OPEN_QUESTIONS.md #1). The venues and properties are demo ones."""
    expo = await _get_or_add(session, m.Venue, "code", "DEMO-BLR-EXPO", name="Demo Expo Centre", city="Bengaluru")
    thane = await _get_or_add(session, m.Venue, "code", "DEMO-THANE", name="Demo Thane Showroom", city="Thane")
    props = {p.code: p for p in (await session.execute(select(m.Property))).scalars()}
    tbc = "FICTITIOUS example: which location / property this prefix belongs to is to be confirmed by Club8."
    for prefix, company, venue, prop, next_number in (
        ("MSMC8", club8, None, None, 9001),  # Club8, every location: the prefix used so far
        ("MSMK8", k8, None, None, 5001),  # K8's prefixes are not known yet
        ("MSMBL", club8, expo, None, 1001),  # one sales venue
        ("C8MPR", club8, None, props["GOA-DEMO-PREM"], 1001),  # one property
        ("C8MTHN", club8, thane, props["OOTY-DEMO-SUP"], 1001),  # a venue and a property
    ):
        await _get_or_add(
            session,
            m.MembershipNumberSeries,
            "prefix",
            prefix,
            company_id=company.id,
            venue_id=venue.id if venue else None,
            property_id=prop.id if prop else None,
            next_number=next_number,
            active_from=date(2020, 1, 1),
            to_be_confirmed=True,
            notes=tbc,
        )


async def seed_demo(session: AsyncSession) -> None:
    await seed_reference(session)
    club8 = await _get_or_add(
        session,
        m.Company,
        "code",
        "CLUB8",
        name="CLUB8 Holidays",
        legal_name="Multiple Sales and Marketing LLP",
        brand="CLUB8 Holidays",
        receipt_prefix="RC8",
        registered_address="DEMO ADDRESS - Bengaluru, Karnataka",
        logo_path="club8/club8-logo.png",
        primary_colour="#393186",
        accent_colour="#EF7F1B",
    )
    k8 = await _get_or_add(
        session,
        m.Company,
        "code",
        "K8",
        name="K8",
        # K8's legal entity and address are not confirmed (docs/OPEN_QUESTIONS.md); never assume the Club8 LLP.
        legal_name="Klub Eight Asia Ventures",
        brand="K8",
        receipt_prefix="RK8",
        registered_address="DEMO ADDRESS - pending confirmation",
        logo_path="k8/k8-logo.png",
        primary_colour="#172040",
        accent_colour="#BC9C23",
        details_pending_confirmation=True,
    )
    await _get_or_add(
        session,
        m.Product,
        "code",
        "C8-STD",
        name="Club8 Standard Membership",
        company_id=club8.id,
        allowed_tenures=[5, 10, 15, 20],
    )
    await _get_or_add(session, m.Venue, "code", "DEMO-MALL", name="Demo Mall Atrium", city="Bengaluru")
    goa = await _get_or_add(session, m.Destination, "code", "GOA", name="Goa")
    ooty = await _get_or_add(session, m.Destination, "code", "OOTY", name="Ooty")
    cats = {c.code: c for c in (await session.execute(select(m.ResortCategory))).scalars()}
    await _get_or_add(
        session,
        m.Property,
        "code",
        "GOA-DEMO-PREM",
        name="Demo Beach Resort (Premium)",
        destination_id=goa.id,
        resort_category_id=cats["PREMIUM"].id,
    )
    await _get_or_add(
        session,
        m.Property,
        "code",
        "OOTY-DEMO-SUP",
        name="Demo Hill Resort (Supreme)",
        destination_id=ooty.id,
        resort_category_id=cats["SUPREME"].id,
    )
    await _seed_number_series(session, club8, k8)

    seasons = {s.code: s for s in (await session.execute(select(m.Season))).scalars()}
    if not (await session.execute(select(m.SeasonCalendar))).first():
        for year in range(2026, 2038):  # DEMO season calendar - real calendar is OPEN_QUESTIONS #10
            for code, start, end in (
                ("BLUE", (1, 6), (3, 31)),
                ("WHITE", (4, 1), (4, 30)),
                ("RED", (5, 1), (6, 15)),
                ("BLUE", (6, 16), (9, 30)),
                ("WHITE", (10, 1), (12, 19)),
                ("RED", (12, 20), (12, 31)),
                ("RED", (1, 1), (1, 5)),
            ):
                session.add(
                    m.SeasonCalendar(
                        season_id=seasons[code].id, start_date=date(year, *start), end_date=date(year, *end)
                    )
                )
    if not (await session.execute(select(m.HolidayCalendar))).first():
        for d, n in ((date(2026, 10, 20), "Demo holiday"), (date(2026, 11, 8), "Demo holiday 2")):
            session.add(m.HolidayCalendar(holiday_date=d, name=n))

    # GST 5% on ASF is confirmed by Club8 (13-Oct-2026); still master data, effective-dated.
    if not (await session.execute(select(m.TaxRate).where(m.TaxRate.code == "GST_ASF"))).first():
        session.add(m.TaxRate(code="GST_ASF", rate_percent=Decimal("5"), effective_from=date(2017, 7, 1)))
    units = {u.code: u for u in (await session.execute(select(m.UnitType))).scalars()}
    if not (await session.execute(select(m.AsfRate))).first():
        for code, amount in (("T0", "12000.00"), ("T1", "15000.00")):  # DEMO ASF amounts, not client prices
            session.add(
                m.AsfRate(
                    unit_type_id=units[code].id,
                    amount=Decimal(amount),
                    currency="INR",
                    effective_from=date(2026, 1, 1),
                    override_reason="DEMO DATA",
                )
            )
    if not (await session.execute(select(m.CancellationTier))).first():
        for lo, hi, pct in ((31, None, "100"), (15, 30, "50"), (0, 14, "0")):
            session.add(
                m.CancellationTier(
                    min_days=lo,
                    max_days=hi,
                    credit_percent=Decimal(pct),
                    rounding_mode="DOWN",
                    effective_from=date(2026, 1, 1),
                )
            )
    if not (await session.execute(select(m.DeductionMatrix))).first():  # DEMO matrix (OPEN_QUESTIONS #8)
        session.add(
            m.DeductionMatrix(
                booked_category="SUPREME",
                purchased_category="PREMIUM",
                multiplier=Decimal("1.5"),
                effective_from=date(2026, 1, 1),
            )
        )
        session.add(
            m.DeductionMatrix(
                booked_category="PREMIUM",
                purchased_category="PREMIUM",
                multiplier=Decimal("1"),
                effective_from=date(2026, 1, 1),
            )
        )
        # an upgrade costs more: a Studio (T0) member staying in a One-Bedroom (T1) uses 1.5 nights per night. More
        # specific than the two category rows above, so it wins over them (demo clip 1).
        session.add(
            m.DeductionMatrix(
                purchased_category="PREMIUM",
                purchased_unit_type="T0",
                booked_unit_type="T1",
                multiplier=Decimal("1.5"),
                effective_from=date(2026, 1, 1),
            )
        )
    roles = {r.code: r for r in (await session.execute(select(Role))).scalars()}
    for username, name, rcodes in DEMO_USERS:
        if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none() is None:
            session.add(
                User(
                    username=username,
                    full_name=name,
                    password_hash=hash_password(DEMO_PASSWORD),
                    roles=[roles[c] for c in rcodes],
                    email=f"{username}@example.test",  # FICTITIOUS (reserved .test domain); shown in Mailpit
                )
            )
    await session.flush()
    from app.auth.service import _fernet

    for username, secret in DEMO_TOTP_USERS.items():
        u = (await session.execute(select(User).where(User.username == username))).scalar_one()
        if not u.totp_enabled:
            u.totp_secret_enc = _fernet().encrypt(secret.encode()).decode()
            u.totp_enabled = True
    await session.flush()


async def main() -> None:
    async with sessionmaker()() as s:
        await seed_demo(s)
        await s.commit()
    print("Demo master data and users seeded (DEMO values only).")


if __name__ == "__main__":
    asyncio.run(main())
