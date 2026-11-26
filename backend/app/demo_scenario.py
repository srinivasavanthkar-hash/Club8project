"""Section 14 initial-delivery demo, driven through the public API with FICTITIOUS data only.

Used by tests/integration/test_demo_flow.py (in-process) and scripts/seed-demo.sh (against a running API).
Every step asserts its business outcome so the demo doubles as an acceptance test.
"""

from __future__ import annotations

import random
import string
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol

from app.core.timeutil import add_working_days, now_utc, today_ist
from app.core.validators import verhoeff_check_digit


class Client(Protocol):
    async def login(self, username: str, password: str | None = None) -> dict[str, Any]: ...
    async def get(self, url: str, **kw: Any) -> Any: ...
    async def post(self, url: str, json: Any = None, headers: dict[str, str] | None = None, **kw: Any) -> Any: ...
    async def patch(self, url: str, json: Any = None, headers: dict[str, str] | None = None) -> Any: ...


def _ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text}"
    return r.json()


def fake_pan(rng: random.Random) -> str:
    return (
        "".join(rng.choices(string.ascii_uppercase, k=5))
        + f"{rng.randint(0, 9999):04d}"
        + rng.choice(string.ascii_uppercase)
    )


def fake_aadhaar(rng: random.Random) -> str:
    base = str(rng.randint(2, 9)) + "".join(rng.choices(string.digits, k=10))
    return base + verhoeff_check_digit(base)


def fake_mobile(rng: random.Random) -> str:
    return "9" + "".join(rng.choices(string.digits, k=9))


MINIMAL_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj"
    b" 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
)


async def master(c: Client, slug: str, code: str, key: str = "code") -> dict[str, Any]:
    rows = _ok(await c.get(f"/api/v1/admin/master/{slug}"))
    return next(r for r in rows if r[key] == code)


def stay_dates(today: date) -> tuple[date, date, date, date]:
    """Two stays in the same membership year, inside the booking window and the demo season calendar."""
    first = add_working_days(today, 10, set())
    if first.year != today.year or (first.month == 12 and first.day > 15):
        first = date(today.year + 1, 2, 2)
    return first, first + timedelta(days=4), first + timedelta(days=7), first + timedelta(days=9)


async def run_demo(c: Client, seed: int | None = None) -> dict[str, Any]:
    rng = random.Random(seed)  # noqa: S311 - fictitious demo data, not security-relevant
    today = today_ist()
    tag = "".join(rng.choices(string.ascii_uppercase, k=4))
    name = f"Asha Demo {tag}"
    mobile = fake_mobile(rng)
    email = f"asha.demo.{tag.lower()}@example.com"
    report: dict[str, Any] = {}

    # ---- 1. Lead -> ATTENDED -> convert (Premium / Red / Studio / 7 nights / 10 years / EMI)
    await c.login("demo.marketing")
    venue = await master(c, "venues", "DEMO-MALL")
    lead = _ok(
        await c.post(
            "/api/v1/leads",
            json={
                "prospect_name": name,
                "mobile": mobile,
                "whatsapp_same_as_mobile": True,
                "email": email,
                "city": "Bengaluru",
                "venue_id": venue["id"],
                "opc_name": "Demo OPC",
                "note": "Met at demo stall",
            },
        ),
        201,
    )
    for st, extra in (
        ("CONTACTED", {}),
        ("PRESENTATION_SCHEDULED", {"presentation_at": datetime.combine(today, datetime.min.time()).isoformat()}),
        ("ATTENDED", {}),
    ):
        lead = _ok(await c.post(f"/api/v1/leads/{lead['id']}/status", json={"status": st, **extra}))
    assert lead["status"] == "ATTENDED"

    sales = await c.login("demo.sales")
    staff = {u["username"]: u for u in _ok(await c.get("/api/v1/admin/staff"))}
    company = await master(c, "companies", "CLUB8")
    cat = await master(c, "resort-categories", "PREMIUM")
    season = await master(c, "seasons", "RED")
    studio = await master(c, "unit-types", "T0")
    card = await master(c, "payment-methods", "CARD")
    prefill = _ok(await c.get(f"/api/v1/leads/{lead['id']}/conversion-prefill"))
    assert prefill["applicant1"]["full_name"] == name
    start = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    member = _ok(
        await c.post(
            f"/api/v1/leads/{lead['id']}/convert",
            json={
                "applicant1": {
                    "full_name": name,
                    "dob": "1988-04-12",
                    "mobile": mobile,
                    "email": email,
                    "kyc": [
                        {"id_type": "PAN", "value": fake_pan(rng)},
                        {"id_type": "AADHAAR", "value": fake_aadhaar(rng)},
                    ],
                },
                "address": {"line1": "12 Demo Street", "city": "Bengaluru", "postcode": "560001", "state": "Karnataka"},
                "email": email,
                "company_id": company["id"],
                "purchase_date": today.isoformat(),
                "tenure_years": 10,
                "first_year_of_use": today.year,
                "resort_category_id": cat["id"],
                "season_id": season["id"],
                "unit_type_id": studio["id"],
                "nights_per_year": "7",
                "purchase_price": "250000.00",
                "admin_fees": "5000.00",
                "down_payment_amount": "55000.00",
                "down_payment_method_id": card["id"],
                "down_payment": {
                    "payment_date": today.isoformat(),
                    "transaction_ref": f"DEMO-CARD-{tag}",
                    "card_last4": "4242",
                },
                "balance_mode": "EMI",
                "emi_amount": "20000.00",
                "emi_count": 10,
                "emi_start_month": start.month,
                "emi_start_year": start.year,
                "relationship_manager_id": sales["id"],
                "team_manager_id": staff["demo.team"]["id"],
                "agreement_signed_applicant1": True,
                "agreement_signed_company": True,
                "agreement_signed_date": today.isoformat(),
            },
        ),
        201,
    )
    mid = member["id"]
    assert member["status"] == "PENDING_APPROVAL" and member["total_price"] == "255000.00"
    assert member["balance"] == "200000.00" and member["last_year_of_use"] == today.year + 9
    assert member["source_lead_id"] == lead["id"]
    lead_after = _ok(await c.get(f"/api/v1/leads/{lead['id']}"))
    assert lead_after["status"] == "CONVERTED" and lead_after["member_id"] == mid
    report["membership_number"] = member["membership_number"]

    # ---- 2. Signed agreement upload, then approval -> ACTIVE
    chk = _ok(await c.get(f"/api/v1/members/{mid}/approval-check"))
    assert not chk["can_approve"] and any("agreement" in b for b in chk["blockers"])
    agreement_type = await master(c, "document-types", "MEMBERSHIP_AGREEMENT_SIGNED")
    _ok(
        await c.post(
            f"/api/v1/members/{mid}/documents",
            data={"document_type_id": agreement_type["id"], "description": "Signed agreement (demo)"},
            files={"file": ("signed-agreement.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    # a profile edit, to show old/new values in the activity log
    _ok(
        await c.patch(
            f"/api/v1/members/{mid}",
            json={
                "version": member["version"],
                "comments": "Prefers sea-facing rooms",
                "reason": "Captured from welcome call",
            },
        )
    )
    await c.login("demo.manager")
    member = _ok(await c.post(f"/api/v1/members/{mid}/approve", json={"comments": "Demo approval"}))
    assert member["status"] == "ACTIVE" and member["approved_by"]

    # ---- 3. Down payment (recorded at conversion by card), EMI schedule, one EMI payment + receipt
    await c.login("demo.finance")
    pays = _ok(await c.get(f"/api/v1/members/{mid}/payments"))
    down = next(p for p in pays if p["payment_type_code"] == "DOWN_PAYMENT")
    assert down["card_last4"] == "4242" and down["receipt_document_id"]
    sched = _ok(await c.post(f"/api/v1/members/{mid}/schedule", json={}), 201)
    assert len(sched["instalments"]) == 10
    assert sum(Decimal(i["amount_due"]) for i in sched["instalments"]) == Decimal("200000.00")
    upi = await master(c, "payment-methods", "UPI")
    emi = _ok(
        await c.post(
            f"/api/v1/members/{mid}/payments",
            json={
                "payment_type_code": "MEMBERSHIP_EMI",
                "base_amount": "20000.00",
                "payment_date": today.isoformat(),
                "payment_method_id": upi["id"],
                "transaction_ref": f"DEMO-UPI-{tag}",
            },
        ),
        201,
    )
    assert emi["payment"]["receipt_number"] and emi["payment"]["receipt_document_id"]
    assert emi["payment"]["gst_amount"] == "0.00"  # GST applies to ASF only
    assert emi["allocations"][0]["amount"] == "20000.00"

    # ---- 4. Reservation: ASF (+5% GST) raised at booking
    await c.login("demo.reservations")
    goa = await master(c, "destinations", "GOA")
    prop = await master(c, "properties", "GOA-DEMO-PREM")
    ci, co, ci2, co2 = stay_dates(today)
    booking = {
        "destination_id": goa["id"],
        "property_id": prop["id"],
        "unit_type_id": studio["id"],
        "adults": 2,
        "child_ages": [6],
        "check_in": ci.isoformat(),
        "check_out": co.isoformat(),
    }
    quote = _ok(await c.post(f"/api/v1/members/{mid}/reservations/quote", json=booking))
    assert quote["entitlement_nights"] == "4.0" and not quote["blocking"], quote
    res = _ok(await c.post(f"/api/v1/members/{mid}/reservations", json=booking), 201)
    rid = res["id"]
    detail = _ok(await c.get(f"/api/v1/reservations/{rid}"))
    asf = detail["asf_charges"]
    assert len(asf) == 1 and asf[0]["status"] == "RAISED"
    assert Decimal(asf[0]["gst"]) == (Decimal(asf[0]["base"]) * Decimal("0.05")).quantize(Decimal("0.01"))
    report["asf_total"] = asf[0]["total"]

    # ---- 5. Requested -> Approved -> (blocked) -> ASF paid -> Confirmed; one deduction; second booking: no ASF
    r = await c.post(
        f"/api/v1/reservations/{rid}/status", json={"to_status": "CONFIRMED", "confirmation_number": "CNF-DEMO-1"}
    )
    assert r.status_code == 422  # not approved yet
    _ok(await c.post(f"/api/v1/reservations/{rid}/status", json={"to_status": "APPROVED"}))
    blocked = await c.post(
        f"/api/v1/reservations/{rid}/status", json={"to_status": "CONFIRMED", "confirmation_number": "CNF-DEMO-1"}
    )
    assert blocked.status_code == 422 and "ASF" in blocked.text
    report["confirmation_blocked_until_asf_paid"] = True
    await c.login("demo.finance")
    _ok(
        await c.post(
            f"/api/v1/members/{mid}/payments",
            json={
                "payment_type_code": "ASF",
                "base_amount": asf[0]["base"],
                "payment_date": today.isoformat(),
                "payment_method_id": card["id"],
                "transaction_ref": f"DEMO-ASF-{tag}",
                "card_last4": "4242",
                "asf_charge_id": asf[0]["id"],
                "reservation_id": rid,
            },
        ),
        201,
    )
    await c.login("demo.reservations")
    confirmed = _ok(
        await c.post(
            f"/api/v1/reservations/{rid}/status", json={"to_status": "CONFIRMED", "confirmation_number": "CNF-DEMO-1"}
        )
    )
    assert confirmed["reservation"]["status"] == "CONFIRMED"
    again = await c.post(f"/api/v1/reservations/{rid}/status", json={"to_status": "APPROVED"})
    assert again.status_code == 422  # cannot re-approve -> cannot deduct twice
    ent = _ok(await c.get(f"/api/v1/members/{mid}/entitlement"))
    year = next(y for y in ent["years"] if y["year"] == ci.year)
    assert Decimal(year["used"]) == 4 and Decimal(year["remaining"]) == 3, year
    ledger = _ok(await c.get(f"/api/v1/members/{mid}/entitlement/ledger"))
    assert len([e for e in ledger if e["entry_type"] == "DEDUCTION" and e["reservation_id"] == rid]) == 1
    second = _ok(
        await c.post(
            f"/api/v1/members/{mid}/reservations",
            json={**booking, "check_in": ci2.isoformat(), "check_out": co2.isoformat(), "child_ages": []},
        ),
        201,
    )
    d2 = _ok(await c.get(f"/api/v1/reservations/{second['id']}"))
    assert [a["id"] for a in d2["asf_charges"]] == [asf[0]["id"]] and d2["unpaid_asf_years"] == []
    asf_status = _ok(await c.get(f"/api/v1/members/{mid}/asf"))
    assert len([y for y in asf_status if y["status"] != "NOT_YET_DUE"]) == 1
    report["remaining_after"] = year["remaining"]

    # ---- 6. One email and one call
    await c.login("demo.service")
    _ok(
        await c.post(
            f"/api/v1/members/{mid}/emails",
            json={
                "direction": "INCOMING",
                "sent_at": now_utc().isoformat(),
                "sender": email,
                "to": ["reservations@example.com"],
                "subject": "Goa stay - early check-in?",
                "body": "Could we check in early? (demo)",
                "reservation_id": rid,
            },
        ),
        201,
    )
    _ok(
        await c.post(
            f"/api/v1/members/{mid}/calls",
            json={
                "direction": "OUTGOING",
                "called_at": now_utc().isoformat(),
                "contact_number": mobile,
                "summary": "Welcome call (demo)",
                "next_action": "Send voucher",
                "next_action_date": (today + timedelta(days=2)).isoformat(),
            },
        ),
        201,
    )

    # ---- 7. Upload a PDF and preview it
    other = await master(c, "document-types", "OTHER")
    doc = _ok(
        await c.post(
            f"/api/v1/members/{mid}/documents",
            data={"document_type_id": other["id"]},
            files={"file": ("demo-note.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    preview = _ok(await c.get(f"/api/v1/documents/{doc['id']}/url", params={"inline": "true"}))
    assert preview["content_type"] == "application/pdf" and preview["url"]

    # ---- 8. Activity log for this member shows every step, incl. old/new values for an edit
    await c.login("demo.manager")
    log = _ok(await c.get("/api/v1/activity-log", params={"member_id": mid, "page_size": 200}))
    actions = {i["action"] for i in log["items"]}
    for needed in (
        "INSERT",
        "STATUS_CHANGE",
        "LEAD_CONVERTED",
        "UPLOAD",
        "MEMBER_APPROVED",
        "PAYMENT",
        "SCHEDULE_GENERATED",
        "ASF_RAISED",
        "ENTITLEMENT_DEDUCTED",
        "UPDATE",
    ):
        assert needed in actions, f"{needed} missing from activity log: {sorted(actions)}"
    edits = [
        i
        for i in log["items"]
        if i["action"] == "UPDATE" and i["entity_type"] == "members" and i["changes"] and "comments" in i["changes"]
    ]
    assert any(e["changes"]["comments"] == [None, "Prefers sea-facing rooms"] for e in edits), edits
    report.update(member_id=mid, lead_id=lead["id"], reservation_id=rid, activity_entries=log["total"])
    return report
