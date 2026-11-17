"""Cancelling confirmed reservations (D-31 to D-34): notice date from the written request, tiers, ASF, voucher and
letter."""

from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import text

from app.core.timeutil import IST, today_ist
from app.demo_scenario import MINIMAL_PDF, master
from tests.integration.helpers import active_member, booking, ok
from tests.integration.test_finance_reservations import _confirmed, _pay_asf

pytestmark = pytest.mark.integration


async def _reason(api, kind="CANCEL"):
    return next(x for x in ok(await api.get("/api/v1/admin/master/reasons")) if x["kind"] == kind)


async def _member_email(api, m, sent_on, subject="Please cancel my Goa stay"):
    await api.login("demo.service")
    e = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/emails",
            json={
                "direction": "INCOMING",
                "sent_at": datetime.combine(sent_on, time(10, 0), IST).isoformat(),
                "sender": m["email"],
                "to": ["reservations@example.com"],
                "subject": subject,
                "body": "Please cancel the booking.",
            },
        ),
        201,
    )
    await api.login("demo.reservations")
    return f"email:{e['id']}"


async def _confirmed_days_ago(api, engine, m, ci, days, nights=4):
    """A confirmed booking whose confirmation happened `days` ago (time travel on the status history)."""
    r = await _confirmed(api, m, ci, nights)
    async with engine.begin() as c:
        await c.execute(
            text(
                "UPDATE reservation_status_history SET changed_at = changed_at - make_interval(days => :d)"
                " WHERE reservation_id = :r"
            ),
            {"d": days, "r": r["id"]},
        )
    return r


async def _asf(api, r_id):
    return ok(await api.get(f"/api/v1/reservations/{r_id}"))["asf_charges"]


async def test_notice_counts_from_the_written_request(api, engine):
    m = await active_member(api)
    today = today_ist()
    ci = today + timedelta(days=25)
    r = await _confirmed_days_ago(api, engine, m, ci, days=15)
    voucher = ok(await api.post(f"/api/v1/reservations/{r['id']}/voucher"), 201)
    ref = await _member_email(api, m, today - timedelta(days=10))
    terms_url = f"/api/v1/reservations/{r['id']}/cancellation-terms"

    t = ok(await api.get(terms_url, params={"communication_ref": ref}))
    assert t["default_date"] == (today - timedelta(days=10)).isoformat() and t["date_source"] == "REQUEST"
    assert t["notice_days"] == 35 and t["tier_percent"] == "100" and t["problems"] == []
    assert t["summary"] == "35 days' notice → 100%: 4.0 nights credited, 0.0 forfeited"
    assert t["request"]["label"] == "Please cancel my Goa stay"

    # staff may move the date, with a reason, but not into the future or before the confirmation
    t = ok(await api.get(terms_url, params={"communication_ref": ref, "cancel_date": today.isoformat()}))
    assert t["problems"] == ["Give a reason for changing the cancellation date"]
    future = (today + timedelta(days=1)).isoformat()
    t = ok(
        await api.get(
            terms_url, params={"communication_ref": ref, "cancel_date": future, "cancel_date_reason": "x y z"}
        )
    )
    assert "The cancellation date cannot be in the future" in t["problems"]
    early = (today - timedelta(days=20)).isoformat()
    t = ok(
        await api.get(terms_url, params={"communication_ref": ref, "cancel_date": early, "cancel_date_reason": "x y z"})
    )
    assert any("before the booking was confirmed" in p for p in t["problems"])

    # no written request: refused, as before
    reason = await _reason(api)
    body = {"to_status": "CANCELLED", "reason_id": reason["id"], "reason_text": "Family emergency"}
    x = await api.post(f"/api/v1/reservations/{r['id']}/status", json=body)
    assert x.status_code == 422 and x.json()["code"] == "WrittenCommunicationRequired"
    # a generated document (the voucher) is not the member's request
    x = await api.post(
        f"/api/v1/reservations/{r['id']}/status", json={**body, "communication_ref": f"document:{voucher['id']}"}
    )
    assert x.status_code == 422 and x.json()["code"] == "WrittenCommunicationRequired"
    # a changed date without a reason is refused on submit too
    x = await api.post(
        f"/api/v1/reservations/{r['id']}/status",
        json={**body, "communication_ref": ref, "cancel_date": today.isoformat()},
    )
    assert x.status_code == 422 and x.json()["code"] == "CancellationDate"

    out = ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/status",
            json={
                **body,
                "communication_ref": ref,
                "cancel_date": today.isoformat(),
                "cancel_date_reason": "Email was sent to an old address; member agreed",
            },
        )
    )
    assert out["entitlement"]["credited"] == "2.0" and out["entitlement"]["forfeited"] == "2.0"
    assert out["entitlement"]["summary"] == "25 days' notice → 50%: 2.0 nights credited, 2.0 forfeited"
    assert out["asf_withdrawn"] == []  # the ASF was paid: never withdrawn or refunded
    c = out["reservation"]["cancellation"]
    assert c["date_source"] == "STAFF" and c["cancel_date"] == today.isoformat()
    assert c["date_reason"] == "Email was sent to an old address; member agreed"
    assert c["reason"] == reason["name"] and c["vouchers_voided"] == [voucher["id"]]

    detail = ok(await api.get(f"/api/v1/reservations/{r['id']}"))
    docs = {d["type"]: d for d in detail["documents"]}
    assert docs["VOUCHER"]["voided_at"] and "cancelled" in docs["VOUCHER"]["void_reason"]
    assert docs["CANCELLATION_LETTER"]["id"] == c["letter_document_id"] and not docs["CANCELLATION_LETTER"]["voided_at"]
    assert [a["status"] for a in detail["asf_charges"]] == ["PAID"]
    ent = ok(await api.get(f"/api/v1/members/{m['id']}/entitlement"))
    y = next(v for v in ent["years"] if v["year"] == ci.year)
    assert y["remaining"] == "5.0" and y["credited_back"] == "2.0"


async def test_uploaded_letter_counts_from_its_upload_day(api, engine):
    m = await active_member(api)
    today = today_ist()
    r = await _confirmed_days_ago(api, engine, m, today + timedelta(days=40), days=5)
    letter_type = await master(api, "document-types", "MEMBER_LETTER")
    await api.login("demo.reservations")
    doc = ok(
        await api.post(
            f"/api/v1/members/{m['id']}/documents",
            data={"document_type_id": letter_type["id"], "description": "Cancellation letter from member"},
            files={"file": ("member-letter.pdf", MINIMAL_PDF, "application/pdf")},
        ),
        201,
    )
    t = ok(
        await api.get(
            f"/api/v1/reservations/{r['id']}/cancellation-terms", params={"communication_ref": f"document:{doc['id']}"}
        )
    )
    assert t["default_date"] == today.isoformat() and t["request"]["label"] == "member-letter.pdf"
    assert t["summary"] == "40 days' notice → 100%: 4.0 nights credited, 0.0 forfeited"


async def test_request_before_confirmation_counts_from_the_confirmation(api, engine):
    m = await active_member(api)
    today = today_ist()
    r = await _confirmed_days_ago(api, engine, m, today + timedelta(days=30), days=3)
    ref = await _member_email(api, m, today - timedelta(days=9))
    t = ok(await api.get(f"/api/v1/reservations/{r['id']}/cancellation-terms", params={"communication_ref": ref}))
    assert t["date_source"] == "CONFIRMATION" and t["default_date"] == (today - timedelta(days=3)).isoformat()
    assert t["notice_days"] == 33 and t["problems"] == []


async def test_unpaid_asf_withdrawn_on_decline_and_raised_again(api):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=30)
    await api.login("demo.reservations")
    r1 = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    [charge] = await _asf(api, r1["id"])
    assert charge["status"] == "RAISED"
    decline = await _reason(api, "DECLINE")
    out = ok(
        await api.post(
            f"/api/v1/reservations/{r1['id']}/status",
            json={"to_status": "DECLINED", "reason_id": decline["id"], "reason_text": "Sold out"},
        )
    )
    assert out["asf_withdrawn"] == [ci.year]
    [charge] = await _asf(api, r1["id"])
    assert (
        charge["status"] == "WITHDRAWN"
        and charge["withdrawn_reason"] == f"Reservation {r1['reservation_number']} declined"
    )
    summary = ok(await api.get(f"/api/v1/members/{m['id']}/finance-summary"))
    assert summary["totals"]["outstanding"]["ASF"] == {}  # no longer owed
    # a withdrawn charge can't be paid
    await api.login("demo.finance")
    card = await master(api, "payment-methods", "CARD")
    x = await api.post(
        f"/api/v1/members/{m['id']}/payments",
        json={
            "payment_type_code": "ASF",
            "base_amount": charge["base"],
            "payment_date": today_ist().isoformat(),
            "payment_method_id": card["id"],
            "transaction_ref": "ASF-W",
            "asf_charge_id": charge["id"],
        },
    )
    assert x.status_code == 409 and x.json()["code"] == "AsfWithdrawn"
    # the next booking in that year raises the same charge again
    await api.login("demo.reservations")
    r2 = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    [again] = await _asf(api, r2["id"])
    assert again["id"] == charge["id"] and again["status"] == "RAISED" and again["withdrawn_on"] is None


async def test_asf_kept_while_another_booking_uses_the_year(api):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=30)
    await api.login("demo.reservations")
    r1 = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    r2 = ok(
        await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci + timedelta(days=5), 3)),
        201,
    )
    cancel = await _reason(api)
    body = {"to_status": "CANCELLED", "reason_id": cancel["id"], "reason_text": "Changed plans"}
    out = ok(await api.post(f"/api/v1/reservations/{r1['id']}/status", json=body))
    assert out["asf_withdrawn"] == [] and out["entitlement"]["tier"] == "FULL_RELEASE"
    assert [c["status"] for c in await _asf(api, r2["id"])] == ["RAISED"]
    out = ok(await api.post(f"/api/v1/reservations/{r2['id']}/status", json=body))
    assert out["asf_withdrawn"] == [ci.year]


async def test_paid_asf_is_never_withdrawn(api):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=30)
    await api.login("demo.reservations")
    r = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    [charge] = await _asf(api, r["id"])
    await _pay_asf(api, m["id"], charge)
    await api.login("demo.reservations")
    cancel = await _reason(api)
    out = ok(
        await api.post(
            f"/api/v1/reservations/{r['id']}/status",
            json={"to_status": "CANCELLED", "reason_id": cancel["id"], "reason_text": "Changed plans"},
        )
    )
    assert out["asf_withdrawn"] == [] and [c["status"] for c in await _asf(api, r["id"])] == ["PAID"]


async def test_setting_off_keeps_unpaid_asf(api, engine):
    m = await active_member(api)
    ci = today_ist() + timedelta(days=30)
    await api.login("demo.reservations")
    r = ok(await api.post(f"/api/v1/members/{m['id']}/reservations", json=await booking(api, ci, 3)), 201)
    async with engine.begin() as c:
        await c.execute(text("UPDATE system_settings SET value = 'false' WHERE key = 'asf.withdraw_unpaid_on_cancel'"))
    try:
        decline = await _reason(api, "DECLINE")
        out = ok(
            await api.post(
                f"/api/v1/reservations/{r['id']}/status",
                json={"to_status": "DECLINED", "reason_id": decline["id"], "reason_text": "Sold out"},
            )
        )
        assert out["asf_withdrawn"] == [] and [c["status"] for c in await _asf(api, r["id"])] == ["RAISED"]
    finally:
        async with engine.begin() as c:
            await c.execute(
                text("UPDATE system_settings SET value = 'true' WHERE key = 'asf.withdraw_unpaid_on_cancel'")
            )
