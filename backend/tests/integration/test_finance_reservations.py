import asyncio
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.core.timeutil import today_ist
from app.demo_scenario import MINIMAL_PDF, master
from tests.integration.helpers import active_member, booking, ok

pytestmark = pytest.mark.integration


async def _pay_asf(api, member_id, charge):
    card = await master(api, "payment-methods", "CARD")
    await api.login("demo.finance")
    return ok(
        await api.post(
            f"/api/v1/members/{member_id}/payments",
            json={
                "payment_type_code": "ASF",
                "base_amount": charge["base"],
                "payment_date": today_ist().isoformat(),
                "payment_method_id": card["id"],
                "transaction_ref": "ASF-REF",
                "asf_charge_id": charge["id"],
            },
        ),
        201,
    )


async def _emi_member(api, start_offset_months=-3, count=6):
    s = today_ist().replace(day=1)
    y, mth = divmod(s.month - 1 + start_offset_months, 12)
    return await active_member(
        api,
        purchase_price="120000.00",
        down_payment_amount="60000.00",
        balance_mode="EMI",
        emi_amount="10000.00",
        emi_count=count,
        emi_start_month=mth + 1,
        emi_start_year=s.year + y,
    )


async def test_emi_payments_partial_overpay_and_reversal(api):
    m = await _emi_member(api, start_offset_months=1)
    await api.login("demo.finance")
    ok(await api.post(f"/api/v1/members/{m['id']}/schedule", json={}), 201)
    upi = await master(api, "payment-methods", "UPI")
    body = {
        "payment_type_code": "MEMBERSHIP_EMI",
        "payment_date": today_ist().isoformat(),
        "payment_method_id": upi["id"],
        "transaction_ref": "U1",
    }
    r1 = ok(await api.post(f"/api/v1/members/{m['id']}/payments", json={**body, "base_amount": "15000.00"}), 201)
    assert [a["amount"] for a in r1["allocations"]] == ["10000.00", "5000.00"]
    sched = ok(await api.get(f"/api/v1/members/{m['id']}/schedule"))
    assert [i["status"] for i in sched["instalments"][:3]] == ["PAID", "PART_PAID", "PENDING"]
    r2 = ok(await api.post(f"/api/v1/members/{m['id']}/payments", json={**body, "base_amount": "50000.00"}), 201)
    assert r2["credit_carried_forward"] == "5000.00"
    rev = ok(
        await api.post(
            f"/api/v1/payments/{r1['payment']['id']}/corrections",
            json={"kind": "REVERSAL", "reason": "Cheque bounced (test)"},
        ),
        201,
    )
    assert rev["entry_kind"] == "REVERSAL" and rev["total_amount"] == "-15000.00"
    sched = ok(await api.get(f"/api/v1/members/{m['id']}/schedule"))
    assert sum(Decimal(i["amount_paid"]) for i in sched["instalments"]) == Decimal("45000.00")
    r = await api.post(
        f"/api/v1/payments/{r1['payment']['id']}/corrections", json={"kind": "REVERSAL", "reason": "again"}
    )
    assert r.status_code == 409
    await api.login("demo.sales")
    r = await api.post(
        f"/api/v1/payments/{r2['payment']['id']}/corrections", json={"kind": "REVERSAL", "reason": "no perm"}
    )
    assert r.status_code == 403


async def test_default_notice_cure_and_termination_rules(api, engine):
    m = await _emi_member(api, start_offset_months=-3)
    await api.login("demo.finance")
    ok(await api.post(f"/api/v1/members/{m['id']}/schedule", json={}), 201)
    notice = ok(await api.post(f"/api/v1/members/{m['id']}/default-notices"), 201)
    assert notice["deadline"] == (today_ist() + timedelta(days=14)).isoformat() and notice["document_id"]
    assert ok(await api.get(f"/api/v1/members/{m['id']}"))["status"] == "DEFAULT_NOTICE"
    await api.login("demo.manager")
    r = await api.post(f"/api/v1/members/{m['id']}/terminate", json={"reason": "Too early"})
    assert r.status_code == 422 and r.json()["code"] == "NoticeNotExpired"
    await api.login("demo.reservations")
    r = await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, today_ist() + timedelta(30)))
    assert r.status_code == 422 and r.json()["code"] == "MemberNotActive"
    await api.login("demo.finance")
    upi = await master(api, "payment-methods", "UPI")
    ok(
        await api.post(
            f"/api/v1/members/{m['id']}/payments",
            json={
                "payment_type_code": "MEMBERSHIP_EMI",
                "base_amount": notice["amount_overdue"],
                "payment_date": today_ist().isoformat(),
                "payment_method_id": upi["id"],
                "transaction_ref": "CURE",
            },
        ),
        201,
    )
    assert ok(await api.get(f"/api/v1/members/{m['id']}"))["status"] == "ACTIVE"


async def test_termination_after_deadline(api, engine):
    m = await _emi_member(api, start_offset_months=-3)
    await api.login("demo.finance")
    ok(await api.post(f"/api/v1/members/{m['id']}/schedule", json={}), 201)
    ok(await api.post(f"/api/v1/members/{m['id']}/default-notices"), 201)
    async with engine.begin() as c:  # move the notice into the past (time travel for the test)
        await c.execute(
            text(
                "UPDATE default_notices SET issued_on = issued_on - 20, deadline = deadline - 20 WHERE member_id = :m"
            ),
            {"m": m["id"]},
        )
    await api.login("demo.manager")
    t = ok(await api.post(f"/api/v1/members/{m['id']}/terminate", json={"reason": "Default not cured"}))
    assert t["status"] == "TERMINATED"
    pays = ok(await api.get(f"/api/v1/members/{m['id']}/payments"))
    assert pays and all(p["is_forfeited"] for p in pays)
    summary = ok(await api.get(f"/api/v1/members/{m['id']}/finance-summary"))
    assert Decimal(summary["totals"]["outstanding"]["MEMBERSHIP_EMI"]["INR"]) > 0  # liability stays visible


async def test_borrowing_raises_future_asf_at_current_rate(api):
    m = await active_member(api, nights_per_year="3")
    await api.login("demo.reservations")
    ci = today_ist() + timedelta(days=30)
    if ci.year != today_ist().year:
        pytest.skip("near year end")
    q = ok(await api.post(f"/api/v1/members/{m['id']}/reservations/quote", json=await booking(api, ci, nights=5)))
    assert [(p["year"], p["kind"]) for p in q["plan"]] == [(ci.year, "CURRENT"), (ci.year + 1, "BORROWED")]
    assert sorted(a["membership_year"] for a in q["asf"]) == [ci.year, ci.year + 1]
    assert len({a["total"] for a in q["asf"]}) == 1  # same (current) rate for both years
    r = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, nights=5)), 201)
    d = ok(await api.get(f"/api/v1/reservations/{r['id']}"))
    assert [c["membership_year"] for c in d["asf_charges"]] == [ci.year, ci.year + 1]


async def test_insufficient_entitlement_needs_paid_nights(api):
    m = await active_member(api, nights_per_year="2", tenure_years=1)
    await api.login("demo.reservations")
    b = await booking(api, today_ist() + timedelta(days=30), nights=4)
    r = await api.post(f"/api/v1/members/{m['id']}/reservations", json=b)
    if r.status_code == 422 and r.json()["code"] == "BookingWindow":
        pytest.skip("calendar edge")
    assert r.status_code == 422 and r.json()["code"] == "InsufficientEntitlement"
    res = ok(
        await api.post(f"/api/v1/members/{m['id']}/reservations", json={**b, "accept_additional_paid_nights": True}),
        201,
    )
    assert res["entitlement_nights"] == "2.0" and res["additional_paid_nights"] == "2.0"


async def test_booking_window_and_occupancy_overrides(api):
    m = await active_member(api)
    await api.login("demo.reservations")
    soon = await booking(api, today_ist() + timedelta(days=2), nights=2)
    r = await api.post(f"/api/v1/members/{m['id']}/reservations", json=soon)
    assert r.status_code == 422 and r.json()["code"] == "BookingWindow"
    ok(
        await api.post(
            f"/api/v1/members/{m['id']}/reservations",
            json={**soon, "window_override_reason": "Member emergency, property has rooms"},
        ),
        201,
    )
    crowd = await booking(api, today_ist() + timedelta(days=40), nights=1, adults=3)
    r = await api.post(f"/api/v1/members/{m['id']}/reservations", json=crowd)
    assert r.status_code == 422 and r.json()["code"] == "Occupancy"
    gift = await booking(api, today_ist() + timedelta(days=40), nights=1, occupancy_type="GIFT")
    r = await api.post(f"/api/v1/members/{m['id']}/reservations", json=gift)
    assert r.status_code == 422 and r.json()["code"] == "GiftRent"


async def _confirmed(api, m, ci, nights=4):
    await api.login("demo.reservations")
    r = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, nights)), 201)
    ok(await api.post(f"/api/v1/reservations/{r['id']}/status", json={"to_status": "APPROVED"}))
    d = ok(await api.get(f"/api/v1/reservations/{r['id']}"))
    for c in d["asf_charges"]:
        if c["status"] != "PAID":
            await _pay_asf(api, m["id"], c)
    await api.login("demo.reservations")
    ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/status", json={"to_status": "CONFIRMED", "confirmation_number": "C-1"}
        )
    )
    return r


async def test_cancellation_tiers_need_written_request(api):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=20)  # 15-30 days -> 50%
    r = await _confirmed(api, m, ci, nights=4)
    reason = next(x for x in ok(await api.get("/api/v1/admin/master/reasons")) if x["code"] == "MEMBER_REQUEST")
    body = {"to_status": "CANCELLED", "reason_id": reason["id"], "reason_text": "Family emergency"}
    x = await api.post(f"/api/v1/reservations/{r['id']}/status", json=body)
    assert x.status_code == 422 and x.json()["code"] == "WrittenCommunicationRequired"
    await api.login("demo.service")
    e = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/emails",
            json={
                "direction": "INCOMING",
                "sent_at": "2026-10-15T10:00:00+05:30",
                "sender": m["email"],
                "to": ["res@example.com"],
                "subject": "Please cancel",
                "body": "Cancel my Goa booking",
            },
        ),
        201,
    )
    await api.login("demo.reservations")
    out = ok(
        await api.post(f"/api/v1/reservations/{r['id']}/status", json={**body, "communication_ref": f"email:{e['id']}"})
    )
    assert out["entitlement"]["credited"] == "2.0" and out["entitlement"]["forfeited"] == "2.0"
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    y = next(v for v in ent["years"] if v["year"] == ci.year)
    assert y["remaining"] == "5.0" and y["credited_back"] == "2.0"


async def test_decline_releases_hold(api):
    m = await active_member(api)
    await api.login("demo.reservations")
    ci = today_ist() + timedelta(days=30)
    r = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    assert next(v for v in ent["years"] if v["year"] == ci.year)["on_hold"] == "3.0"
    reason = next(x for x in ok(await api.get("/api/v1/admin/master/reasons")) if x["kind"] == "DECLINE")
    ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/status",
            json={"to_status": "DECLINED", "reason_id": reason["id"], "reason_text": "Sold out"},
        )
    )
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    y = next(v for v in ent["years"] if v["year"] == ci.year)
    assert y["on_hold"] == "0.0" and y["remaining"] == "7.0"


async def test_reschedule_adjusts_existing_deduction_and_limit(api):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=30)
    r = await _confirmed(api, m, ci, nights=2)
    for i, n in enumerate((3, 4)):
        new_ci = ci + timedelta(days=7 * (i + 1))
        x = ok(
            await api.post(
                f"/api/v1/reservations/{r['id']}/reschedule",
                json={
                    "check_in": new_ci.isoformat(),
                    "check_out": (new_ci + timedelta(days=n)).isoformat(),
                    "reason": f"Member request {i}",
                },
            )
        )
        assert x["status"] == "RESCHEDULED" and len(x["date_versions"]) == i + 2
        assert x["date_versions"][0]["check_in"] == ci.isoformat()  # original kept
    ledger = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement/ledger"))
    mine = [e for e in ledger if e["reservation_id"] == r["id"]]
    assert len([e for e in mine if e["entry_type"] == "DEDUCTION"]) == 1
    assert sum(Decimal(e["delta"]) for e in mine) == Decimal("-4.0")  # net effect = latest stay only
    third = await api.post(
        f"/api/v1/reservations/{r['id']}/reschedule",
        json={
            "check_in": (ci + timedelta(days=60)).isoformat(),
            "check_out": (ci + timedelta(days=61)).isoformat(),
            "reason": "Third time",
        },
    )
    assert third.status_code == 422 and third.json()["code"] == "RescheduleLimit"
    await api.login("demo.manager")  # has reservation.override
    ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/reschedule",
            json={
                "check_in": (ci + timedelta(days=60)).isoformat(),
                "check_out": (ci + timedelta(days=61)).isoformat(),
                "reason": "Third time",
                "override_reason": "Medical certificate received",
            },
        )
    )


async def test_confirmation_override_by_permission(api):
    m = await active_member(api)
    await api.login("demo.reservations")
    r = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/reservations", json=await booking(api, today_ist() + timedelta(days=30), 2)
        ),
        201,
    )
    ok(await api.post(f"/api/v1/reservations/{r['id']}/status", json={"to_status": "APPROVED"}))
    x = await api.post(
        f"/api/v1/reservations/{r['id']}/status",
        json={"to_status": "CONFIRMED", "confirmation_number": "C9", "override_reason": "Try"},
    )
    assert x.status_code == 422  # reservations role lacks reservation.override
    await api.login("demo.manager")
    ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/status",
            json={
                "to_status": "CONFIRMED",
                "confirmation_number": "C9",
                "override_reason": "VIP, ASF promised by cheque",
            },
        )
    )


async def test_concurrent_bookings_cannot_double_spend(api, engine):
    m = await active_member(api)
    await api.login("demo.reservations")
    ci = today_ist() + timedelta(days=30)
    b1 = await booking(api, ci, nights=5)
    b2 = await booking(api, ci + timedelta(days=10), nights=5)
    if ci.year != (ci + timedelta(days=15)).year:
        pytest.skip("year boundary")
    rs = await asyncio.gather(
        api.post(f"/api/v1/members/{m['id']}/reservations", json=b1),
        api.post(f"/api/v1/members/{m['id']}/reservations", json=b2),
    )
    codes = sorted(r.status_code for r in rs)
    assert codes[0] == 201
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    total_balance = sum(Decimal(y["remaining"]) for y in ent["years"])
    assert total_balance >= 0
    async with engine.connect() as c:
        neg = (
            await c.execute(
                text(
                    "SELECT origin_year, sum(delta) FROM entitlement_ledger WHERE member_id=:m "
                    "GROUP BY origin_year HAVING sum(delta) < 0"
                ),
                {"m": m["id"]},
            )
        ).all()
    assert neg == []


async def test_document_rules(api):
    m = await active_member(api)
    await api.login("demo.sales")
    other = await master(api, "document-types", "OTHER")
    r = await api.post(
        f"/api/v1/members/{m['id']}/documents",
        data={"document_type_id": other["id"]},
        files={"file": ("evil.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")},
    )
    assert r.status_code == 422 and r.json()["code"] == "FileTypeNotAllowed"
    kyc = await master(api, "document-types", "KYC_PAN")
    d = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/documents",
            data={"document_type_id": kyc["id"]},
            files={"file": ("pan.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    assert (await api.get(f"/api/v1/documents/{d['id']}/url")).status_code == 403  # sales lacks kyc.view_full
    await api.login("demo.manager")
    ok(await api.get(f"/api/v1/documents/{d['id']}/url", params={"inline": "false"}))
    log = ok(await api.get("/api/v1/activity-log", params={"action": "SENSITIVE_DOWNLOAD", "member_id": m["id"]}))
    assert log["total"] == 1
    assert (await api.post(f"/api/v1/documents/{d['id']}/delete", json={"reason": ""})).status_code == 422
    ok(await api.post(f"/api/v1/documents/{d['id']}/delete", json={"reason": "Uploaded to wrong member"}))
    docs = ok(await api.get(f"/api/v1/members/{m['id']}/documents"))
    assert d["id"] not in [x["id"] for x in docs]


async def test_eml_import_threading_and_timeline(api):
    m = await active_member(api)
    await api.login("demo.service")
    eml1 = (
        f"From: Member <{m['email']}>\r\nTo: res@example.com\r\nSubject: Booking query\r\n"
        "Message-ID: <a1@example.com>\r\nDate: Thu, 15 Oct 2026 10:00:00 +0530\r\n\r\nHello"
    ).encode()
    eml2 = (
        f"From: res@example.com\r\nTo: {m['email']}\r\nSubject: Re: Booking query\r\n"
        "Message-ID: <a2@example.com>\r\nIn-Reply-To: <a1@example.com>\r\n"
        "Date: Thu, 15 Oct 2026 11:00:00 +0530\r\n\r\nReply"
    ).encode()
    e1 = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/emails/import",
            data={"direction": "INCOMING"},
            files={"file": ("q.eml", eml1, "message/rfc822")},
        ),
        201,
    )
    e2 = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/emails/import",
            data={"direction": "OUTGOING"},
            files={"file": ("r.eml", eml2, "message/rfc822")},
        ),
        201,
    )
    assert e1["thread_id"] == e2["thread_id"]
    dup = await api.post(
        f"/api/v1/members/{m['id']}/emails/import",
        data={"direction": "INCOMING"},
        files={"file": ("q.eml", eml1, "message/rfc822")},
    )
    assert dup.status_code == 422
    tl = ok(await api.get(f"/api/v1/members/{m['id']}/timeline"))
    kinds = {i["type"] for i in tl}
    assert {"email", "payment", "status", "document"} <= kinds
    only = ok(await api.get(f"/api/v1/members/{m['id']}/timeline", params={"types": ["email"]}))
    assert {i["type"] for i in only} == {"email"}


async def test_saved_nights_expiry_job(api, engine):
    from app.core.db import sessionmaker
    from app.entitlement import service as ent_service
    from app.members.models import Member

    m = await active_member(api, first_year_of_use=today_ist().year)
    async with sessionmaker()() as s:
        member = await s.get(Member, m["id"])
        y0 = member.first_year_of_use
        out = await ent_service.expire_saved(s, member, date(y0 + 3, 1, 1))
        again = await ent_service.expire_saved(s, member, date(y0 + 3, 1, 2))
        await s.commit()
    assert {e.origin_year for e in out} == {y0} and again == []


async def test_defender_verdict_releases_quarantine(api, engine):
    from app.core.db import sessionmaker
    from app.correspondence.documents import refresh_scan_results
    from app.storage.blob import DEFENDER_RESULT_TAG, get_blob_store

    m = await active_member(api)
    await api.login("demo.sales")
    other = await master(api, "document-types", "OTHER")
    d = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/documents",
            data={"document_type_id": other["id"]},
            files={"file": ("scan.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    async with engine.begin() as c:  # simulate the asynchronous (Defender) path
        await c.execute(text("UPDATE documents SET scan_status='PENDING' WHERE id=:i"), {"i": d["id"]})
        path = (await c.execute(text("SELECT blob_path FROM documents WHERE id=:i"), {"i": d["id"]})).scalar_one()
    r = await api.get(f"/api/v1/documents/{d['id']}/url")
    assert r.status_code == 422 and r.json()["code"] == "Quarantined"
    async with sessionmaker()() as s:
        assert await refresh_scan_results(s) == 0  # no verdict yet -> stays quarantined
        await get_blob_store().set_tag(path, DEFENDER_RESULT_TAG, "No threats found")
        assert await refresh_scan_results(s) >= 1
        await s.commit()
    ok(await api.get(f"/api/v1/documents/{d['id']}/url"))
