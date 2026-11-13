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
        membership_prefix="MSMC8",
        receipt_prefix="RC8",
        registered_address="DEMO ADDRESS - Bengaluru, Karnataka",
        next_membership_seq=9001,
        logo_path="club8/club8-logo.png",
        primary_colour="#393186",
        accent_colour="#EF7F1B",
    )
    await _get_or_add(
        session,
        m.Company,
        "code",
        "K8",
        name="K8",
        # K8's legal entity and address are not confirmed (docs/OPEN_QUESTIONS.md); never assume the Club8 LLP.
        legal_name="Klub Eight Asia Ventures",
        brand="K8",
        membership_prefix="MSMK8",
        receipt_prefix="RK8",
        registered_address="DEMO ADDRESS - pending confirmation",
        next_membership_seq=5001,
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
    roles = {r.code: r for r in (await session.execute(select(Role))).scalars()}
    for username, name, rcodes in DEMO_USERS:
        if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none() is None:
            session.add(
                User(
                    username=username,
                    full_name=name,
                    password_hash=hash_password(DEMO_PASSWORD),
                    roles=[roles[c] for c in rcodes],
                    email=f"{username}@example.com",
                )
            )
    await session.flush()


async def main() -> None:
    async with sessionmaker()() as s:
        await seed_demo(s)
        await s.commit()
    print("Demo master data and users seeded (DEMO values only).")


if __name__ == "__main__":
    asyncio.run(main())
