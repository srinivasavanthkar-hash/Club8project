"""Factories that build fictitious records through the API (so every rule and audit hook runs)."""

import random
from datetime import date, timedelta
from typing import Any

from app.core.timeutil import today_ist
from app.demo_scenario import MINIMAL_PDF, fake_aadhaar, fake_mobile, fake_pan, master

_rng = random.Random(4242)


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text}"
    return r.json()


async def member_payload(api: Any, **over: Any) -> dict[str, Any]:
    today = today_ist()
    company = await master(api, "companies", "CLUB8")
    cat = await master(api, "resort-categories", "PREMIUM")
    season = await master(api, "seasons", "RED")
    studio = await master(api, "unit-types", "T0")
    card = await master(api, "payment-methods", "CARD")
    n = _rng.randint(1000, 999999)
    mobile = fake_mobile(_rng)
    p: dict[str, Any] = {
        "applicant1": {
            "full_name": f"Test Member {n}",
            "dob": "1980-01-01",
            "mobile": mobile,
            "kyc": [{"id_type": "PAN", "value": fake_pan(_rng)}],
        },
        "address": {"line1": "1 Test Road", "city": "Mysuru", "postcode": "570001", "state": "Karnataka"},
        "email": f"member{n}@example.com",
        "company_id": company["id"],
        "purchase_date": today.isoformat(),
        "tenure_years": 10,
        "first_year_of_use": today.year,
        "resort_category_id": cat["id"],
        "season_id": season["id"],
        "unit_type_id": studio["id"],
        "nights_per_year": "7",
        "purchase_price": "100000.00",
        "admin_fees": "0.00",
        "down_payment_amount": "100000.00",
        "down_payment_method_id": card["id"],
        "down_payment": {"payment_date": today.isoformat(), "transaction_ref": f"T-{n}", "card_last4": "1111"},
        "balance_mode": "NONE",
    }
    p.update(over)
    return p


async def active_member(api: Any, **over: Any) -> dict[str, Any]:
    """Creates (as sales), uploads agreement and approves (as manager). Leaves api logged in as manager."""
    await api.login("demo.sales")
    m = ok(await api.post("/api/v1/members", json=await member_payload(api, **over)), 201)
    dt = await master(api, "document-types", "MEMBERSHIP_AGREEMENT_SIGNED")
    ok(
        await api.post(
            f"/api/v1/members/{m['id']}/documents",
            data={"document_type_id": dt["id"]},
            files={"file": ("a.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    await api.login("demo.manager")
    return ok(await api.post(f"/api/v1/members/{m['id']}/approve", json={}))


async def booking(api: Any, check_in: date, nights: int = 3, **over: Any) -> dict[str, Any]:
    goa = await master(api, "destinations", "GOA")
    prop = await master(api, "properties", "GOA-DEMO-PREM")
    studio = await master(api, "unit-types", "T0")
    b = {
        "destination_id": goa["id"],
        "property_id": prop["id"],
        "unit_type_id": studio["id"],
        "adults": 2,
        "check_in": check_in.isoformat(),
        "check_out": (check_in + timedelta(days=nights)).isoformat(),
    }
    b.update(over)
    return b


def a_stay(offset_days: int = 30) -> date:
    """A date comfortably inside the booking window, avoiding the demo RED/holiday edge at year end."""
    d = today_ist() + timedelta(days=offset_days)
    return d


__all__ = ["fake_aadhaar", "ok"]
