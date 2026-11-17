"""Auth, RBAC, optimistic locking, audit immutability, search, master data, exports."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.timeutil import today_ist
from app.demo_scenario import master
from tests.integration.helpers import active_member, member_payload, ok

pytestmark = pytest.mark.integration


async def test_login_lockout_and_audit(api):
    from app.admin.service import create_user
    from app.auth.models import User
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        u, _ = await create_user(s, "lock.test", "Lock Test", ["MARKETING"], password="Correct-Horse-9")
        await s.commit()
    for _ in range(5):
        r = await api.c.post("/api/v1/auth/login", json={"username": "lock.test", "password": "wrong"})
        assert r.status_code == 401
    r = await api.c.post("/api/v1/auth/login", json={"username": "lock.test", "password": "Correct-Horse-9"})
    assert r.status_code == 401 and r.json()["code"] == "AccountLocked"
    async with sessionmaker()() as s:
        n = (
            await s.execute(
                text("SELECT count(*) FROM activity_log WHERE action='LOGIN_FAILED' AND entity_id = :i"),
                {"i": str(u.id)},
            )
        ).scalar_one()
        assert n >= 6
        assert (await s.get(User, u.id)).locked_until is not None


async def test_unauthenticated_and_csrf(api):
    api.c.cookies.clear()
    assert (await api.get("/api/v1/members")).status_code == 401
    await api.login("demo.sales")
    r = await api.c.post("/api/v1/leads", json={"prospect_name": "No Csrf", "mobile": "9123456780"})
    assert r.status_code == 403 and r.json()["code"] == "CsrfFailed"


async def test_rbac_enforced_server_side(api):
    await api.login("demo.marketing")
    assert (await api.get("/api/v1/members")).status_code == 403
    assert (await api.get("/api/v1/activity-log")).status_code == 403
    await api.login("demo.finance")
    r = await api.post("/api/v1/members/00000000-0000-0000-0000-000000000000/approve", json={})
    assert r.status_code == 403 and r.json()["missing"] == ["member.approve"]
    me = ok(await api.get("/api/v1/auth/me"))
    assert "payment.correct" in me["permissions"] and "member.approve" not in me["permissions"]


async def test_optimistic_locking_returns_409(api):
    m = await active_member(api)
    await api.login("demo.sales")
    ok(await api.patch(f"/api/v1/members/{m['id']}", json={"version": m["version"], "comments": "first"}))
    r = await api.patch(f"/api/v1/members/{m['id']}", json={"version": m["version"], "comments": "stale"})
    assert r.status_code == 409


async def test_correction_history_is_versioned(api):
    m = await active_member(api)
    await api.login("demo.sales")
    cur = ok(await api.get(f"/api/v1/members/{m['id']}"))
    ok(
        await api.patch(
            f"/api/v1/members/{m['id']}", json={"version": cur["version"], "comments": "v2", "reason": "Member asked"}
        )
    )
    hist = ok(await api.get(f"/api/v1/history/members/{m['id']}"))
    upd = [h for h in hist if h["operation"] == "UPDATE" and h["new"] and h["new"].get("comments") == "v2"]
    assert upd and upd[-1]["reason"] == "Member asked" and "comments" in upd[-1]["old"]


async def test_activity_log_is_append_only_and_verifiable(api, engine):
    await api.login("demo.manager")
    async with engine.connect() as c:
        for stmt in (
            "UPDATE activity_log SET summary='x'",
            "DELETE FROM activity_log",
            "TRUNCATE activity_log",
            "UPDATE entitlement_ledger SET delta = 99",
        ):
            with pytest.raises(DBAPIError, match="append-only"):
                async with c.begin():
                    await c.execute(text(stmt))
    v = ok(await api.post("/api/v1/activity-log/verify"))
    assert v["ok"] and v["checked"] > 10
    # No API exists to modify log entries
    paths = ok(await api.get("/api/v1/openapi.json"))["paths"]
    for p, ops in paths.items():
        if p.startswith("/api/v1/activity-log"):
            assert not ({"put", "patch", "delete"} & set(ops)), p


async def test_tampering_is_detected(api, engine):
    await api.login("demo.manager")
    async with engine.begin() as c:  # a superuser bypassing the trigger (simulated attacker with DB access)
        await c.execute(text("ALTER TABLE activity_log DISABLE TRIGGER activity_log_no_update_delete"))
        await c.execute(
            text(
                "UPDATE activity_log SET summary = summary || ' (edited)' "
                "WHERE seq = (SELECT min(seq)+1 FROM activity_log)"
            )
        )
        await c.execute(text("ALTER TABLE activity_log ENABLE TRIGGER activity_log_no_update_delete"))
    v = ok(await api.post("/api/v1/activity-log/verify"))
    assert not v["ok"] and v["first_broken_seq"] is not None
    async with engine.begin() as c:  # restore so later tests see an intact chain
        await c.execute(text("ALTER TABLE activity_log DISABLE TRIGGER activity_log_no_update_delete"))
        await c.execute(
            text(
                "UPDATE activity_log SET summary = replace(summary, ' (edited)', '') "
                "WHERE seq = (SELECT min(seq)+1 FROM activity_log)"
            )
        )
        await c.execute(text("ALTER TABLE activity_log ENABLE TRIGGER activity_log_no_update_delete"))
    assert ok(await api.post("/api/v1/activity-log/verify"))["ok"]


async def test_global_search(api):
    m = await active_member(api)
    num = m["membership_number"].split("-")[1]
    mobile = m["applicants"][0]["mobile"]
    await api.login("demo.sales")
    for q in (
        num,
        m["membership_number"].lower(),
        "+91 " + mobile[:5] + " " + mobile[5:],
        "0" + mobile,
        m["applicants"][0]["full_name"].split()[-1],
        m["email"].upper(),
    ):
        res = ok(await api.get("/api/v1/search", params={"q": q}))
        assert any(x["id"] == m["id"] for x in res["members"]), q


async def test_asf_rate_cap_warning_and_override(api):
    await api.login("demo.manager")
    t1 = await master(api, "unit-types", "T1")
    yr = today_ist().year + 1
    r = await api.post(
        "/api/v1/admin/master/asf-rates",
        json={"unit_type_id": t1["id"], "amount": "18000.00", "currency": "INR", "effective_from": f"{yr}-01-01"},
    )
    assert r.status_code == 422 and r.json()["code"] == "AsfCapExceeded"
    r = await api.post(
        "/api/v1/admin/master/asf-rates",
        json={"unit_type_id": t1["id"], "amount": "15750.00", "currency": "INR", "effective_from": f"{yr}-01-01"},
    )
    assert r.status_code == 201  # exactly 5%
    r = await api.post(
        "/api/v1/admin/master/asf-rates",
        json={"unit_type_id": t1["id"], "amount": "17000.00", "currency": "INR", "effective_from": f"{yr + 1}-01-01"},
        headers={"X-Override-Reason": "Board approved exceptional revision"},
    )
    assert r.status_code == 201 and r.json()["_warnings"]


async def test_cash_disabled_and_card_number_never_stored(api):
    m = await active_member(api)
    await api.login("demo.finance")
    cash = next(
        x
        for x in ok(await api.get("/api/v1/admin/master/payment-methods", params={"include_inactive": True}))
        if x["code"] == "CASH"
    )
    r = await api.post(
        f"/api/v1/members/{m['id']}/payments",
        json={
            "payment_type_code": "EXTRA",
            "base_amount": "100.00",
            "payment_date": today_ist().isoformat(),
            "payment_method_id": cash["id"],
        },
    )
    assert r.status_code == 422 and r.json()["code"] == "PaymentMethod"
    card = await master(api, "payment-methods", "CARD")
    r = await api.post(
        f"/api/v1/members/{m['id']}/payments",
        json={
            "payment_type_code": "EXTRA",
            "base_amount": "100.00",
            "payment_date": today_ist().isoformat(),
            "payment_method_id": card["id"],
            "transaction_ref": "X",
            "card_last4": "4111111111111111",
        },
    )
    assert r.status_code == 422


async def test_exports_are_logged(api):
    await api.login("demo.manager")
    r = await api.get("/api/v1/exports/members", params={"fmt": "xlsx"})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    r = await api.get("/api/v1/exports/leads")
    assert r.status_code == 200 and r.text.startswith("﻿")
    log = ok(await api.get("/api/v1/activity-log", params={"action": "EXPORT"}))
    assert log["total"] >= 2


async def test_kyc_masked_and_reveal_logged(api):
    m = await active_member(api)
    kyc = m["applicants"][0]["kyc"][0]
    assert kyc["masked"].startswith("******")
    await api.login("demo.sales")
    assert (await api.post(f"/api/v1/kyc/{kyc['id']}/reveal")).status_code == 403
    await api.login("demo.manager")
    v = ok(await api.post(f"/api/v1/kyc/{kyc['id']}/reveal"))
    assert len(v["value"]) == 10 and v["value"].endswith(kyc["masked"][-4:])
    log = ok(await api.get("/api/v1/activity-log", params={"action": "KYC_VIEW", "member_id": m["id"]}))
    assert log["total"] == 1


async def test_aadhaar_stored_masked_only(api, engine):
    import random

    from app.demo_scenario import fake_aadhaar

    await api.login("demo.sales")
    aad = fake_aadhaar(random.Random(7))
    p = await member_payload(api)
    p["applicant1"]["kyc"] = [{"id_type": "AADHAAR", "value": aad}]
    m = ok(await api.post("/api/v1/members", json=p), 201)
    async with engine.connect() as c:
        row = (
            await c.execute(
                text(
                    "SELECT masked, value_encrypted FROM applicant_kyc k JOIN member_applicants a "
                    "ON a.id = k.applicant_id WHERE a.member_id = :m"
                ),
                {"m": m["id"]},
            )
        ).one()
    assert row.masked == f"XXXX-XXXX-{aad[-4:]}" and row.value_encrypted is None
    p = await member_payload(api)
    p["applicant1"]["kyc"] = [{"id_type": "AADHAAR", "value": aad[:-1] + str((int(aad[-1]) + 1) % 10)}]
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and "Verhoeff" in r.text
