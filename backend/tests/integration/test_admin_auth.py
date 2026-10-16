from datetime import timedelta

import pyotp
import pytest

from app.core.timeutil import today_ist
from app.demo_scenario import master
from tests.integration.helpers import active_member, ok

pytestmark = pytest.mark.integration


async def test_refresh_rotation_reuse_detection_and_logout(api):
    await api.login("demo.sales")
    old_refresh = api.c.cookies.get("crm_refresh")
    r = await api.c.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    # replaying the rotated (old) refresh token revokes every session of the user
    api.c.cookies.set("crm_refresh", old_refresh, path="/api/v1/auth")
    r = await api.c.post("/api/v1/auth/refresh")
    assert r.status_code == 401 and r.json()["code"] == "RefreshRevoked"
    await api.login("demo.sales")
    assert (await api.post("/api/v1/auth/logout")).status_code == 204


async def test_totp_two_factor(api):
    from app.admin.service import create_user
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        await create_user(s, "totp.admin", "Totp Admin", "Totp-Passw0rd-1", ["ADMIN"])
        await s.commit()
    await api.login("totp.admin", "Totp-Passw0rd-1")
    uri = ok(await api.post("/api/v1/auth/totp/setup"))["otpauth_uri"]
    secret = pyotp.parse_uri(uri).secret
    assert (await api.post("/api/v1/auth/totp/confirm", json={"code": "000000"})).status_code == 401
    assert (await api.post("/api/v1/auth/totp/confirm", json={"code": pyotp.TOTP(secret).now()})).status_code == 204
    api.c.cookies.clear()
    r = await api.c.post("/api/v1/auth/login", json={"username": "totp.admin", "password": "Totp-Passw0rd-1"})
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    r = await api.c.post(
        "/api/v1/auth/login",
        json={"username": "totp.admin", "password": "Totp-Passw0rd-1", "totp_code": pyotp.TOTP(secret).now()},
    )
    assert r.status_code == 200


async def test_user_and_role_management(api):
    await api.login("demo.admin")
    r = await api.post(
        "/api/v1/admin/users",
        json={"username": "weak.user", "full_name": "Weak", "password": "alllowercase12", "roles": ["SALES"]},
    )
    assert r.status_code == 422
    u = ok(
        await api.post(
            "/api/v1/admin/users",
            json={"username": "new.sales", "full_name": "New Sales", "password": "Str0ng-Password", "roles": ["SALES"]},
        ),
        201,
    )
    u = ok(await api.put(f"/api/v1/admin/users/{u['id']}/roles", json={"roles": ["SALES", "FINANCE"]}))
    assert u["roles"] == ["FINANCE", "SALES"]
    roles = ok(await api.get("/api/v1/admin/roles"))
    mkt = next(r for r in roles if r["code"] == "MARKETING")
    ok(
        await api.put(
            "/api/v1/admin/roles/MARKETING/permissions", json={"permissions": mkt["permissions"] + ["member.view"]}
        )
    )
    await api.login("demo.marketing")
    assert (await api.get("/api/v1/members")).status_code == 200  # management granted it
    await api.login("demo.admin")
    ok(await api.put("/api/v1/admin/roles/MARKETING/permissions", json={"permissions": mkt["permissions"]}))
    assert (
        await api.put("/api/v1/admin/roles/MARKETING/permissions", json={"permissions": ["no.such"]})
    ).status_code == 422
    ok(await api.put(f"/api/v1/admin/users/{u['id']}/active", json={"is_active": False}))
    log = ok(await api.get("/api/v1/activity-log", params={"action": "PERMISSION_CHANGE"}))
    assert log["total"] >= 3
    assert len(ok(await api.get("/api/v1/admin/permissions"))) > 30


async def test_master_data_crud_and_permissions(api):
    await api.login("demo.sales")
    assert (await api.post("/api/v1/admin/master/venues", json={"code": "X", "name": "X"})).status_code == 403
    await api.login("demo.manager")
    v = ok(await api.post("/api/v1/admin/master/venues", json={"code": "NEW-VENUE", "name": "New Venue"}), 201)
    v = ok(await api.patch(f"/api/v1/admin/master/venues/{v['id']}", json={"name": "Renamed Venue"}))
    assert v["name"] == "Renamed Venue"
    r = await api.patch(f"/api/v1/admin/master/venues/{v['id']}", json={"name": "X"}, headers={"If-Match": "1"})
    assert r.status_code == 409
    assert (await api.post("/api/v1/admin/master/venues", json={"code": "B", "bogus": 1})).status_code == 422
    assert (await api.get("/api/v1/admin/master/nope")).status_code == 404
    rate = next(x for x in ok(await api.get("/api/v1/admin/master/asf-rates")))
    r = await api.patch(f"/api/v1/admin/master/asf-rates/{rate['id']}", json={"amount": "1.00"})
    assert r.status_code == 422 and r.json()["code"] == "RateImmutable"
    cash = next(
        x
        for x in ok(await api.get("/api/v1/admin/master/payment-methods", params={"include_inactive": True}))
        if x["code"] == "CASH"
    )
    assert cash["is_active"] is False
    ok(
        await api.post(
            "/api/v1/admin/master/tax-rates",
            json={"code": "GST_ASF", "rate_percent": "5", "effective_from": f"{today_ist().year + 5}-01-01"},
        ),
        201,
    )
    rates = [x for x in ok(await api.get("/api/v1/admin/master/tax-rates")) if x["code"] == "GST_ASF"]
    assert sum(1 for x in rates if x["effective_to"] is None) == 1  # previous rate closed


async def test_instalment_edit_and_payment_meta_edit_need_reason(api):
    s = today_ist().replace(day=1)
    m = await active_member(
        api,
        purchase_price="60000.00",
        down_payment_amount="30000.00",
        balance_mode="EMI",
        emi_amount="10000.00",
        emi_count=3,
        emi_start_month=s.month,
        emi_start_year=s.year + 1,
    )
    await api.login("demo.finance")
    sched = ok(await api.post(f"/api/v1/members/{m['id']}/schedule", json={}), 201)
    inst = sched["instalments"][0]
    assert (
        await api.patch(f"/api/v1/instalments/{inst['id']}", json={"version": inst["version"], "amount_due": "9000"})
    ).status_code == 422
    out = ok(
        await api.patch(
            f"/api/v1/instalments/{inst['id']}",
            json={"version": inst["version"], "amount_due": "9000.00", "reason": "Agreed discount (test)"},
        )
    )
    assert out["warning"] and "balance" in out["warning"]
    hist = ok(await api.get(f"/api/v1/history/schedule_instalments/{inst['id']}"))
    assert hist[-1]["reason"] == "Agreed discount (test)"
    # regenerate allowed while nothing is paid
    ok(await api.post(f"/api/v1/members/{m['id']}/schedule", json={"emi_amount": "15000.00", "emi_count": 2}), 201)
    pay = ok(await api.get(f"/api/v1/members/{m['id']}/payments"))[0]
    out = ok(
        await api.patch(
            f"/api/v1/payments/{pay['id']}",
            json={"version": pay["version"], "transaction_ref": "FIXED-REF", "reason": "Typo in reference"},
        )
    )
    assert out["transaction_ref"] == "FIXED-REF" and out["correction_reason"] == "Typo in reference"
    adj = ok(
        await api.post(
            f"/api/v1/payments/{pay['id']}/corrections",
            json={"kind": "ADJUSTMENT", "amount": "-100.00", "reason": "Bank charge"},
        ),
        201,
    )
    assert adj["total_amount"] == "-100.00"
    allocs = ok(await api.get(f"/api/v1/payments/{pay['id']}/allocations"))
    assert allocs == []
    assert ok(await api.get(f"/api/v1/payments/{pay['id']}"))["receipt_number"]


async def test_lists_filters_dashboards(api):
    m = await active_member(api)
    await api.login("demo.marketing")
    lead = ok(
        await api.post(
            "/api/v1/leads",
            json={
                "prospect_name": "Follow Up",
                "mobile": "9822200001",
                "follow_up_date": (today_ist() - timedelta(days=1)).isoformat(),
            },
        ),
        201,
    )
    res = ok(await api.get("/api/v1/leads", params={"follow_up_due": True, "sort": "-entry_date"}))
    assert any(x["id"] == lead["id"] for x in res["items"])
    assert (await api.get("/api/v1/leads", params={"sort": "password"})).status_code == 422
    fu = ok(await api.get("/api/v1/leads/follow-ups"))
    assert any(any(x["id"] == lead["id"] for x in b["overdue"]) for b in fu)
    await api.login("demo.manager")
    dash = ok(await api.get("/api/v1/dashboard"))
    assert {"follow_ups", "approvals_pending", "overdue_emis", "upcoming_check_ins"} <= dash.keys()
    ok(await api.get("/api/v1/finance/dashboard"))
    totals = ok(await api.get("/api/v1/finance/totals"))
    assert "INR" in totals["collected"]
    page = ok(await api.get("/api/v1/members", params={"status": ["ACTIVE"], "page_size": 5}))
    assert page["page_size"] == 5 and page["total"] >= 1
    ok(await api.get("/api/v1/reservations", params={"member_id": m["id"]}))
    ok(await api.get(f"/api/v1/members/{m['id']}/history"))
    ok(await api.get(f"/api/v1/members/{m['id']}/status-history"))
    ok(await api.get("/api/v1/calls/follow-ups"))
    for e in ("payments", "reservations", "entitlement", "activity-log"):
        assert (await api.get(f"/api/v1/exports/{e}")).status_code == 200
    dups = ok(await api.post("/api/v1/duplicates/check", json={"mobiles": ["9822200001"]}))
    assert dups and dups[0]["kind"] == "LEAD"


async def test_member_status_suspend_and_profile_edit(api):
    m = await active_member(api)
    await api.login("demo.manager")
    ok(await api.post(f"/api/v1/members/{m['id']}/status", json={"to_status": "SUSPENDED", "reason": "Dispute"}))
    r = await api.post(f"/api/v1/members/{m['id']}/status", json={"to_status": "EXPIRED", "reason": "x"})
    assert r.status_code == 422
    ok(await api.post(f"/api/v1/members/{m['id']}/status", json={"to_status": "ACTIVE", "reason": "Resolved"}))
    cur = ok(await api.get(f"/api/v1/members/{m['id']}"))
    a1 = cur["applicants"][0]
    upd = ok(
        await api.patch(
            f"/api/v1/members/{m['id']}",
            json={
                "version": cur["version"],
                "reason": "Address change letter",
                "address": {"line1": "9 New Road", "city": "Mysuru", "postcode": "570002", "state": "Karnataka"},
                "applicant1": {
                    "full_name": a1["full_name"],
                    "dob": a1["dob"],
                    "mobile": a1["mobile"],
                    "kyc": [{"id_type": "DL", "value": "KA0120200001234"}],
                },
            },
        )
    )
    assert upd["address_line1"] == "9 New Road"
    assert {k["id_type"] for k in upd["applicants"][0]["kyc"]} == {"PAN", "DL"}
    await api.login("demo.reservations")
    voucher_res = await api.post("/api/v1/reservations/00000000-0000-0000-0000-000000000000/voucher")
    assert voucher_res.status_code == 404
    other = await master(api, "document-types", "OTHER")
    assert other["code"] == "OTHER"
