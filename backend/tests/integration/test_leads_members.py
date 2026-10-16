import pytest

from app.demo_scenario import master
from tests.integration.helpers import member_payload, ok

pytestmark = pytest.mark.integration


async def _lead(api, **kw):
    body = {"prospect_name": "Ravi Example", "mobile": "9811100001", "city": "Pune", **kw}
    return await api.post("/api/v1/leads", json=body)


async def test_lead_transitions_and_history(api):
    await api.login("demo.marketing")
    lead = ok(await _lead(api, mobile="9811100002"), 201)
    assert lead["lead_number"].startswith("L-")
    r = await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": "ATTENDED"})
    assert r.status_code == 422 and r.json()["code"] == "InvalidTransition"
    ok(await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": "CONTACTED"}))
    r = await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": "PRESENTATION_SCHEDULED"})
    assert r.status_code == 422 and r.json()["code"] == "PresentationAt"
    hist = ok(await api.get(f"/api/v1/leads/{lead['id']}/status-history"))
    assert [h["to_status"] for h in hist] == ["NEW", "CONTACTED"]
    ok(await api.post(f"/api/v1/leads/{lead['id']}/notes", json={"note": "Call after 6pm"}), 201)
    ok(await api.post(f"/api/v1/leads/{lead['id']}/notes", json={"note": "Interested in Goa"}), 201)
    assert len(ok(await api.get(f"/api/v1/leads/{lead['id']}"))["notes"]) == 2


async def test_lead_duplicate_warning_and_override(api):
    await api.login("demo.marketing")
    ok(await _lead(api, mobile="9811100003", email="dup@example.com"), 201)
    r = await _lead(api, prospect_name="Other Person", mobile="+91 98111 00003")
    assert r.status_code == 422 and r.json()["code"] == "ProbableDuplicate"
    assert r.json()["matches"][0]["reasons"] == ["mobile"]
    r = await _lead(
        api, prospect_name="Other Person", mobile="09811100003", duplicate_override_reason="Family member sharing phone"
    )
    assert r.status_code == 201
    log = ok(
        await (await _as(api, "demo.manager")).get("/api/v1/activity-log", params={"action": "DUPLICATE_OVERRIDE"})
    )
    assert log["total"] >= 1


async def _as(api, user):
    await api.login(user)
    return api


async def test_conversion_only_from_attended_and_lead_retained(api):
    await api.login("demo.sales")
    lead = ok(await _lead(api, mobile="9811100004"), 201)
    payload = await member_payload(api)
    r = await api.post(f"/api/v1/leads/{lead['id']}/convert", json=payload)
    assert r.status_code == 422 and r.json()["code"] == "LeadNotAttended"
    for st in ("CONTACTED", "NOT_INTERESTED", "CONTACTED"):
        ok(await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": st}))
    ok(
        await api.post(
            f"/api/v1/leads/{lead['id']}/status",
            json={"status": "PRESENTATION_SCHEDULED", "presentation_at": "2026-10-20T10:00:00+05:30"},
        )
    )
    ok(await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": "ATTENDED"}))
    m = ok(await api.post(f"/api/v1/leads/{lead['id']}/convert", json=payload), 201)
    lead2 = ok(await api.get(f"/api/v1/leads/{lead['id']}"))
    assert lead2["status"] == "CONVERTED" and lead2["member_id"] == m["id"] and m["source_lead_id"] == lead["id"]
    r = await api.patch(f"/api/v1/leads/{lead['id']}", json={"version": lead2["version"], "mobile": "9811100099"})
    assert r.status_code == 422 and r.json()["code"] == "LeadConverted"
    r = await api.post(f"/api/v1/leads/{lead['id']}/convert", json=payload)
    assert r.status_code == 422


async def test_failed_conversion_rolls_back_everything(api):
    await api.login("demo.sales")
    lead = ok(await _lead(api, mobile="9811100005"), 201)
    for st, extra in (
        ("CONTACTED", {}),
        ("PRESENTATION_SCHEDULED", {"presentation_at": "2026-10-20T10:00:00Z"}),
        ("ATTENDED", {}),
    ):
        ok(await api.post(f"/api/v1/leads/{lead['id']}/status", json={"status": st, **extra}))
    payload = await member_payload(api)
    payload["down_payment"]["transaction_ref"] = None  # card needs a reference -> fails inside the transaction
    r = await api.post(f"/api/v1/leads/{lead['id']}/convert", json=payload)
    assert r.status_code == 422 and r.json()["code"] == "ReferenceRequired"
    lead2 = ok(await api.get(f"/api/v1/leads/{lead['id']}"))
    assert lead2["status"] == "ATTENDED" and lead2["member_id"] is None
    res = ok(await api.get("/api/v1/members", params={"q": payload["email"]}))
    assert res["total"] == 0


async def test_member_validation_rules(api):
    await api.login("demo.sales")
    p = await member_payload(api, admin_fees="5000.00")
    p["applicant1"]["dob"] = "2015-01-01"
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and r.json()["code"] == "ApplicantAge"
    p = await member_payload(api, purchase_price="100000.00", down_payment_amount="40000.00", balance_mode="EMI")
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and r.json()["code"] == "EmiFields"
    p = await member_payload(api, last_year_of_use=2040)
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and r.json()["code"] == "LastYearReason"
    p = await member_payload(api)
    p["address"]["postcode"] = "1234"
    assert (await api.post("/api/v1/members", json=p)).status_code == 422


async def test_membership_number_hard_block(api):
    await api.login("demo.sales")
    p = await member_payload(api, membership_number="777001")
    m = ok(await api.post("/api/v1/members", json=p), 201)
    assert m["membership_number"] == "MSMC8-777001"
    p2 = await member_payload(api, membership_number="777001", duplicate_override_reason="try anyway")
    r = await api.post("/api/v1/members", json=p2)
    assert r.status_code == 409 and r.json()["code"] == "DuplicateMembershipNumber"


async def test_approval_gate(api):
    await api.login("demo.sales")
    p = await member_payload(api)
    p.pop("down_payment")
    m = ok(await api.post("/api/v1/members", json=p), 201)
    await api.login("demo.manager")
    r = await api.post(f"/api/v1/members/{m['id']}/approve", json={})
    assert r.status_code == 422
    blockers = r.json()["blockers"]
    assert any("Down payment" in b for b in blockers) and any("agreement" in b for b in blockers)


async def test_custom_fields(api):
    await api.login("demo.manager")
    ok(
        await api.post(
            "/api/v1/admin/master/custom-fields",
            json={
                "field_key": "referral_code",
                "label": "Referral code",
                "field_type": "text",
                "required": False,
                "section": "Sales",
            },
        ),
        201,
    )
    await api.login("demo.sales")
    p = await member_payload(api, custom_fields={"referral_code": "REF-42"})
    m = ok(await api.post("/api/v1/members", json=p), 201)
    assert m["custom_fields"] == {"referral_code": "REF-42"}
    r = await api.post("/api/v1/members", json=await member_payload(api, custom_fields={"nope": 1}))
    assert r.status_code == 422
    found = ok(await api.get("/api/v1/members", params={"custom_field": "referral_code=REF-42"}))
    assert found["total"] == 1


async def test_joining_offer_bonus_nights(api):
    await api.login("demo.sales")
    offer_type = await master(api, "joining-offer-types", "BONUS_NIGHTS")
    from tests.integration.helpers import active_member

    m = await active_member(
        api, joining_offers=[{"offer_type_id": offer_type["id"], "description": "Goa 3 nights welcome", "nights": "3"}]
    )
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    first = ent["years"][0]
    assert first["bonus"] == "3.0" and first["remaining"] == "10.0"
