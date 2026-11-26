"""Passwords and account access (docs/PASSWORD_PROMPT.md Phase 1): forced change, sessions, 2FA, admin resets,
ADMIN-on-ADMIN approval, super-admin fallback, history, expiry, rate limits and log hygiene. Fictitious users only."""

import contextlib
import itertools
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pyotp
import pytest
from sqlalchemy import text, update

from app.core.timeutil import real_now_utc
from tests.integration.conftest import Api
from tests.integration.helpers import ok

pytestmark = pytest.mark.integration

PW = "Silver-Kettle-Morning-71"  # fictitious; not in any breach list, no personal words


@contextlib.asynccontextmanager
async def device() -> AsyncIterator[Api]:
    """A second browser / device: its own cookie jar."""
    from app.main import app

    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50001))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield Api(client)


async def make_user(roles: list[str], password: str = PW, prefix: str = "pw") -> dict[str, Any]:
    from app.admin.service import create_user
    from app.core.db import sessionmaker

    username = f"{prefix}.{uuid.uuid4().hex[:6]}"
    async with sessionmaker()() as s:
        u, _ = await create_user(s, username, "Test Person", roles, password=password)
        await s.commit()
    return {"id": str(u.id), "username": username}


async def enable_totp(api: Api) -> str:
    uri = ok(await api.post("/api/v1/auth/totp/setup"))["otpauth_uri"]
    secret = pyotp.parse_uri(uri).secret
    ok(await api.post("/api/v1/auth/totp/confirm", json={"code": pyotp.TOTP(secret).now()}))
    return str(secret)


async def login_raw(api: Api, username: str, password: str, totp: str | None = None) -> httpx.Response:
    api.c.cookies.clear()
    body = {"username": username, "password": password}
    if totp:
        body["totp_code"] = pyotp.TOTP(totp).now()
    return await api.c.post("/api/v1/auth/login", json=body)


async def actions_for(user_id: str) -> list[str]:
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        rows = await s.execute(
            text("SELECT action FROM activity_log WHERE entity_id = :i ORDER BY seq"), {"i": user_id}
        )
        return [r[0] for r in rows]


async def admin_reset(api: Api, user_id: str, reason: str = "Locked out, verified by phone") -> dict[str, Any]:
    await api.login("demo.admin")
    return ok(await api.post(f"/api/v1/admin/users/{user_id}/reset-password", json={"reason": reason}))


async def test_admin_reset_keeps_2fa_and_forces_change_before_anything_else(api):
    u = await make_user(["SALES"])
    async with device() as phone:
        await phone.login(u["username"], PW)
        secret = await enable_totp(phone)
        assert (await phone.get("/api/v1/members")).status_code == 200

        out = await admin_reset(api, u["id"])
        assert out["status"] == "RESET" and out["temporary_password"] and out["expires_at"]
        temp = out["temporary_password"]
        # every existing session ends at once (no 15-minute gap): the phone's access token is refused now
        r = await phone.get("/api/v1/members")
        assert r.status_code == 401 and r.json()["code"] == "SessionRevoked"
        assert (await phone.c.post("/api/v1/auth/refresh")).status_code == 401

    # the reset never touched 2FA: sign in -> 2FA code -> forced change
    r = await login_raw(api, u["username"], temp)
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    me = ok(await login_raw(api, u["username"], temp, secret))
    assert me["must_change_password"] and me["password_is_temporary"] and me["permissions"] == []
    for url in ("/api/v1/members", "/api/v1/leads", "/api/v1/dashboard"):
        r = await api.get(url)
        assert r.status_code == 403 and r.json()["code"] == "PasswordChangeRequired", url
    assert ok(await api.get("/api/v1/auth/me"))["must_change_password"]

    async def change(current: str, new: str) -> httpx.Response:
        return await api.post(
            "/api/v1/auth/change-password",
            json={"current_password": current, "new_password": new, "sign_out_other_devices": False},
        )

    r = await change("wrong-temporary", "Brand-New-Phrase-For-Me")
    assert r.status_code == 401 and r.json()["code"] == "CurrentPasswordIncorrect"
    assert "temporary password" in r.json()["detail"]
    r = await change(temp, "password1234")
    assert r.status_code == 422 and [p["code"] for p in r.json()["problems"]] == ["Breached"]
    assert "data breach" in r.json()["detail"]
    r = await change(temp, f"{u['username']} rules ok")
    assert r.status_code == 422 and r.json()["problems"][0]["code"] == "ContainsPersonal"
    r = await change(temp, "short")
    assert r.status_code == 422 and r.json()["problems"][0]["code"] == "TooShort"
    me = ok(await change(temp, "Brand-New-Phrase-For-Me"))
    assert not me["must_change_password"] and not me["password_is_temporary"] and me["permissions"]
    assert (await api.get("/api/v1/members")).status_code == 200
    # still the same 2FA afterwards
    assert ok(await login_raw(api, u["username"], "Brand-New-Phrase-For-Me", secret))["totp_enabled"]

    log = await actions_for(u["id"])
    for a in (
        "PASSWORD_RESET_BY_ADMIN",
        "SESSIONS_REVOKED",
        "TEMP_PASSWORD_ISSUED",
        "TEMP_PASSWORD_USED",
        "PASSWORD_CHANGE_FAILED",
        "PASSWORD_CHANGED",
    ):
        assert a in log, a
    assert "TOTP_RESET_BY_ADMIN" not in log


async def test_change_password_sign_out_other_devices(api):
    u = await make_user(["SALES"])
    await api.login(u["username"], PW)
    async with device() as laptop:
        await laptop.login(u["username"], PW)
        new = "Paper-Boat-Harbour-28"
        r = await api.post(
            "/api/v1/auth/change-password",
            json={"current_password": PW, "new_password": new, "sign_out_other_devices": True},
        )
        ok(r)
        assert "crm_access" in r.cookies  # this device continues with fresh tokens
        assert (await api.get("/api/v1/members")).status_code == 200
        r = await laptop.get("/api/v1/members")
        assert r.status_code == 401 and r.json()["code"] == "SessionRevoked"
        assert (await laptop.c.post("/api/v1/auth/refresh")).status_code == 401

        # unticked: the other device stays signed in
        await laptop.login(u["username"], new)
        ok(
            await api.post(
                "/api/v1/auth/change-password",
                json={
                    "current_password": new,
                    "new_password": "Velvet-Comet-Lagoon-33",
                    "sign_out_other_devices": False,
                },
            )
        )
        assert (await laptop.get("/api/v1/members")).status_code == 200
    assert (await actions_for(u["id"])).count("PASSWORD_CHANGED") == 2


async def test_wrong_current_password_counts_toward_lockout(api):
    u = await make_user(["MARKETING"])
    await api.login(u["username"], PW)
    for _ in range(5):
        r = await api.post(
            "/api/v1/auth/change-password",
            json={"current_password": "not-my-password", "new_password": "Whatever-Long-Phrase"},
        )
        assert r.status_code == 401
    r = await api.post(
        "/api/v1/auth/change-password", json={"current_password": PW, "new_password": "Whatever-Long-Phrase"}
    )
    assert r.status_code == 403 and r.json()["code"] == "AccountLocked"
    r = await login_raw(api, u["username"], PW)
    assert r.status_code == 401 and r.json()["code"] == "AccountLocked"
    # an admin reset clears the lockout
    temp = (await admin_reset(api, u["id"]))["temporary_password"]
    ok(await login_raw(api, u["username"], temp))
    assert "LOCKOUT_CLEARED" in await actions_for(u["id"])


async def test_history_blocks_reuse_of_last_five(api):
    u = await make_user(["MARKETING"])
    await api.login(u["username"], PW)
    passwords = [PW] + [f"History-Phrase-Number-{n}" for n in range(1, 6)]
    for old, new in itertools.pairwise(passwords):
        ok(await api.post("/api/v1/auth/change-password", json={"current_password": old, "new_password": new}))
        await api.login(u["username"], new)
    current = passwords[-1]
    for reused in passwords[1:]:  # the current one and the four before it
        r = await api.post("/api/v1/auth/change-password", json={"current_password": current, "new_password": reused})
        assert r.status_code == 422 and r.json()["problems"][0]["code"] == "Reused", reused
    # the original password is now six changes old: allowed again
    ok(await api.post("/api/v1/auth/change-password", json={"current_password": current, "new_password": PW}))


async def test_temporary_password_expires_after_24_hours(api):
    from app.auth.models import User
    from app.auth.recovery import expire_temporary_passwords
    from app.core.db import sessionmaker

    u = await make_user(["SALES"])
    out = await admin_reset(api, u["id"])
    hours = ((await _dt(out["expires_at"])) - real_now_utc()).total_seconds() / 3600
    assert 23.9 < hours <= 24
    async with sessionmaker()() as s:
        await s.execute(
            update(User)
            .where(User.id == uuid.UUID(u["id"]))
            .values(temp_password_expires_at=real_now_utc() - timedelta(minutes=1))
        )
        await s.commit()
    r = await login_raw(api, u["username"], out["temporary_password"])
    assert r.status_code == 401 and r.json()["code"] == "TemporaryPasswordExpired"
    async with sessionmaker()() as s:
        assert await expire_temporary_passwords(s) >= 1
        await s.commit()
    async with sessionmaker()() as s:
        assert await expire_temporary_passwords(s) == 0  # idempotent
    assert (await actions_for(u["id"])).count("TEMP_PASSWORD_EXPIRED") == 2  # sign-in attempt + job


async def _dt(s: str):  # type: ignore[no-untyped-def]
    from datetime import datetime

    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def test_admin_reset_safeguards(api):
    u = await make_user(["SALES"])
    me = await api.login("demo.admin")
    r = await api.post(f"/api/v1/admin/users/{me['id']}/reset-password", json={"reason": "Forgot it myself"})
    assert r.status_code == 403 and r.json()["code"] == "CannotResetOwnPassword"
    r = await api.post(f"/api/v1/admin/users/{me['id']}/reset-2fa", json={"reason": "New phone myself"})
    assert r.status_code == 403 and r.json()["code"] == "CannotResetOwn2FA"
    for body in ({}, {"reason": "   "}, {"reason": "x"}):
        assert (await api.post(f"/api/v1/admin/users/{u['id']}/reset-password", json=body)).status_code == 422
    await api.login("demo.manager")  # MANAGEMENT has admin rights but not the recovery permissions
    r = await api.post(f"/api/v1/admin/users/{u['id']}/reset-password", json={"reason": "Locked out today"})
    assert r.status_code == 403 and r.json()["missing"] == ["user.reset_password"]
    r = await api.post(f"/api/v1/admin/users/{u['id']}/reset-2fa", json={"reason": "Lost the phone"})
    assert r.status_code == 403 and r.json()["missing"] == ["user.reset_2fa"]


async def test_resetting_an_admin_needs_a_second_admin(api):
    target = await make_user(["ADMIN"], prefix="adm")
    approver = await make_user(["ADMIN"], prefix="adm")
    async with device() as target_session:
        await target_session.login(target["username"], PW)
        out = await admin_reset(api, target["id"], "Admin locked out, confirmed in person")
        assert out["status"] == "PENDING_APPROVAL" and out["temporary_password"] is None
        assert (await target_session.get("/api/v1/members")).status_code == 200  # nothing happens until approved
        r = await api.post(f"/api/v1/admin/users/{target['id']}/reset-password", json={"reason": "Second attempt"})
        assert r.status_code == 409 and r.json()["code"] == "ResetAlreadyPending"
        rid = out["request_id"]
        pending = ok(await api.get("/api/v1/admin/reset-requests"))
        assert any(p["id"] == rid and p["target_username"] == target["username"] for p in pending)
        r = await api.post(f"/api/v1/admin/reset-requests/{rid}/approve", json={"reason": "Approving my own"})
        assert r.status_code == 403 and r.json()["code"] == "SameAdmin"
        r = await target_session.post(f"/api/v1/admin/reset-requests/{rid}/approve", json={"reason": "It is me"})
        assert r.status_code == 403 and r.json()["code"] == "SameAdmin"

        await api.login(approver["username"], PW)
        r = await api.post(f"/api/v1/admin/reset-requests/{rid}/approve", json={"reason": "Confirmed by phone"})
        res = ok(r)
        assert res["status"] == "RESET" and res["temporary_password"]
        assert (await target_session.get("/api/v1/members")).status_code == 401
    me = ok(await login_raw(api, target["username"], res["temporary_password"]))
    assert me["must_change_password"]
    log = await actions_for(target["id"])
    for a in ("ADMIN_RESET_REQUESTED", "ADMIN_RESET_APPROVED", "PASSWORD_RESET_BY_ADMIN", "TEMP_PASSWORD_ISSUED"):
        assert a in log, a


async def test_admin_reset_request_expires_and_can_be_rejected(api):
    from app.auth.models import AdminResetRequest
    from app.core.db import sessionmaker

    target = await make_user(["ADMIN"], prefix="adm")
    approver = await make_user(["ADMIN"], prefix="adm")
    rid = (await admin_reset(api, target["id"]))["request_id"]
    async with sessionmaker()() as s:
        await s.execute(
            update(AdminResetRequest)
            .where(AdminResetRequest.id == uuid.UUID(rid))
            .values(expires_at=real_now_utc() - timedelta(seconds=1))
        )
        await s.commit()
    await api.login(approver["username"], PW)
    r = await api.post(f"/api/v1/admin/reset-requests/{rid}/approve", json={"reason": "Too late approval"})
    assert r.status_code == 409 and r.json()["code"] == "RequestNotPending"
    assert "ADMIN_RESET_EXPIRED" in await actions_for(target["id"])
    rid = (await admin_reset(api, target["id"]))["request_id"]  # a new request is possible after expiry
    await api.login(approver["username"], PW)
    r = await api.post(f"/api/v1/admin/reset-requests/{rid}/reject", json={"reason": "Not verified with the user"})
    assert r.status_code == 204
    assert "ADMIN_RESET_REJECTED" in await actions_for(target["id"])


async def test_super_admin_fallback_when_no_second_admin(api, monkeypatch):
    from app.auth import recovery
    from app.core.config import get_settings

    target = await make_user(["ADMIN"], prefix="adm")

    async def only_one(session, user):  # type: ignore[no-untyped-def]
        return 1

    monkeypatch.setattr(recovery, "_other_active_admins", only_one)
    me = await api.login("demo.admin")
    r = await api.post(f"/api/v1/admin/users/{target['id']}/reset-password", json={"reason": "Only admin left"})
    assert r.status_code == 403 and r.json()["code"] == "ApprovalUnavailable"
    monkeypatch.setattr(get_settings(), "super_admin_username", me["username"])
    out = ok(await api.post(f"/api/v1/admin/users/{target['id']}/reset-password", json={"reason": "Only admin left"}))
    assert out["status"] == "RESET" and out["super_admin_fallback"] is True
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        summary = (
            await s.execute(
                text("SELECT summary FROM activity_log WHERE action = 'PASSWORD_RESET_SUPER_ADMIN' AND entity_id = :i"),
                {"i": target["id"]},
            )
        ).scalar_one()
    assert summary.startswith("[SUPER-ADMIN FALLBACK]")


async def test_reset_2fa_forces_enrolment_and_leaves_the_password(api):
    u = await make_user(["FINANCE"])
    await api.login(u["username"], PW)
    await enable_totp(api)
    r = await api.post("/api/v1/auth/totp/setup")  # cannot silently replace or switch off 2FA
    assert r.status_code == 409 and r.json()["code"] == "TotpAlreadyEnabled"
    async with device() as admin:
        await admin.login("demo.admin")
        out = ok(
            await admin.post(f"/api/v1/admin/users/{u['id']}/reset-2fa", json={"reason": "Lost phone, ID checked"})
        )
        assert out["must_enroll_totp"] and not out["totp_enabled"]
    assert (await api.get("/api/v1/auth/me")).status_code == 401  # sessions ended
    me = ok(await login_raw(api, u["username"], PW))  # same password, no code needed now
    assert me["must_enroll_totp"] and not me["must_change_password"]
    r = await api.get("/api/v1/finance/dashboard")
    assert r.status_code == 403 and r.json()["code"] == "TotpEnrolmentRequired"
    secret = await enable_totp(api)
    assert not ok(await api.get("/api/v1/auth/me"))["must_enroll_totp"]
    r = await login_raw(api, u["username"], PW)
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    ok(await login_raw(api, u["username"], PW, secret))
    assert "TOTP_RESET_BY_ADMIN" in await actions_for(u["id"])


async def test_new_user_gets_a_generated_temporary_password(api):
    await api.login("demo.admin")
    name = f"new.{uuid.uuid4().hex[:6]}"
    out = ok(
        await api.post("/api/v1/admin/users", json={"username": name, "full_name": "New Starter", "roles": ["SALES"]}),
        201,
    )
    me = ok(await login_raw(api, name, out["temporary_password"]))
    assert me["must_change_password"] and me["password_is_temporary"]
    assert "TEMP_PASSWORD_ISSUED" in await actions_for(out["id"])


async def test_rate_limits_per_account(api, monkeypatch):
    from app.core.config import get_settings
    from app.core.ratelimit import reset_account_limits

    u = await make_user(["SALES"])
    start_seq = await _max_seq()
    s = get_settings()
    monkeypatch.setattr(s, "rate_limit_login_account", "3/minute")
    monkeypatch.setattr(s, "rate_limit_change_password", "2/minute")
    await reset_account_limits()
    try:
        for _ in range(3):
            assert (await login_raw(api, u["username"], "wrong-password")).status_code == 401
        r = await login_raw(api, u["username"], PW)  # even the right password is refused once over the limit
        assert r.status_code == 429 and r.json()["code"] == "RateLimited"
        await reset_account_limits()
        await api.login(u["username"], PW)
        for _ in range(2):
            r = await api.post("/api/v1/auth/change-password", json={"current_password": "x", "new_password": "y"})
            assert r.status_code == 401
        r = await api.post(
            "/api/v1/auth/change-password", json={"current_password": PW, "new_password": "Zz-Long-Phrase-99"}
        )
        assert r.status_code == 429
    finally:
        await reset_account_limits()
    from app.core.db import sessionmaker

    async with sessionmaker()() as session:
        n = (
            await session.execute(
                text("SELECT summary FROM activity_log WHERE action = 'RATE_LIMITED' AND seq > :s"),
                {"s": start_seq},
            )
        ).scalars()
        events = list(n)
    # the per-account sign-in limit names the account; the change-password refusal may come from the per-IP limit
    # (slowapi, same setting) before the per-account one, and is logged either way
    assert any(u["username"] in e for e in events) and len(events) >= 2


async def test_no_password_or_token_in_logs_activity_log_or_errors(api, caplog):
    """Log scrubbing: run every Phase 1 flow with marker values, then search everything that is persisted or logged."""
    from app.core.db import sessionmaker

    caplog.set_level(logging.DEBUG)
    start_seq = await _max_seq()
    u = await make_user(["SALES"], password="Marker-Initial-Secret-1")
    secrets_seen: list[str] = ["Marker-Initial-Secret-1"]
    r = await login_raw(api, u["username"], "Marker-Wrong-Secret-2")
    secrets_seen.append("Marker-Wrong-Secret-2")
    assert "Marker-Wrong-Secret-2" not in r.text
    await api.login(u["username"], "Marker-Initial-Secret-1")
    secrets_seen += [api.c.cookies.get("crm_access") or "", api.c.cookies.get("crm_refresh") or ""]
    r = await api.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Marker-Initial-Secret-1", "new_password": "Marker-Next-Secret-3"},
    )
    ok(r)
    secrets_seen.append("Marker-Next-Secret-3")
    r = await api.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Marker-Next-Secret-3", "new_password": "password1234"},
    )
    assert r.status_code == 422 and "password1234" not in r.text
    temp = (await admin_reset(api, u["id"]))["temporary_password"]
    secrets_seen.append(temp)
    ok(await login_raw(api, u["username"], temp))
    secrets_seen += [api.c.cookies.get("crm_access") or "", api.c.cookies.get("crm_refresh") or ""]
    secrets_seen = [s for s in secrets_seen if s]
    logging.getLogger("crm.test").info("debug dump %s", {"password": temp, "token": secrets_seen[2]})

    async with sessionmaker()() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT coalesce(summary,'') || ' ' || coalesce(changes::text,'') || ' ' "
                    "|| coalesce(entity_ref,'') "
                    "FROM activity_log WHERE seq > :s"
                ),
                {"s": start_seq},
            )
        ).scalars()
        persisted = "\n".join(rows)
        versions = "\n".join(
            (
                await s.execute(
                    text(
                        "SELECT coalesce(old_values::text,'') || coalesce(new_values::text,'') FROM record_versions "
                        "WHERE record_id = :i"
                    ),
                    {"i": u["id"]},
                )
            ).scalars()
        )
        hashes = list(
            (await s.execute(text("SELECT password_hash FROM users WHERE id = :i"), {"i": u["id"]})).scalars()
        )
    for secret in [*secrets_seen, *hashes, "password1234"]:
        assert secret not in persisted, "secret in activity log"
        assert secret not in versions, "secret in record versions"
        assert secret not in caplog.text, "secret in application logs"
    assert '"***"' in versions  # the password_hash change is recorded, redacted


async def _max_seq() -> int:
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        return int((await s.execute(text("SELECT coalesce(max(seq), 0) FROM activity_log"))).scalar_one())


async def test_demo_admin_signs_in_with_2fa(api):
    from app.seed_demo import DEMO_PASSWORD

    r = await login_raw(api, "demo.admin", DEMO_PASSWORD)
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    assert (await api.login("demo.admin"))["totp_enabled"]  # the test client completes the 2FA step


async def test_temporary_password_with_2fa_order_and_no_change_without_2fa(api):
    """sign in -> 2FA code -> change-password screen; no session exists (so no change) before the code."""
    u = await make_user(["SALES"])
    await api.login(u["username"], PW)
    secret = await enable_totp(api)
    temp = (await admin_reset(api, u["id"]))["temporary_password"]

    r = await login_raw(api, u["username"], temp)
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    assert "crm_access" not in api.c.cookies  # nothing issued before the 2FA step
    r = await api.post(
        "/api/v1/auth/change-password", json={"current_password": temp, "new_password": "Granite-Bay-Echo-19"}
    )
    assert r.status_code == 401
    me = ok(await login_raw(api, u["username"], temp, secret))
    assert me["must_change_password"]
    ok(
        await api.post(
            "/api/v1/auth/change-password", json={"current_password": temp, "new_password": "Granite-Bay-Echo-19"}
        )
    )


async def test_change_password_refused_from_a_session_that_has_not_passed_2fa(api):
    u = await make_user(["SALES"])
    async with device() as older:
        await older.login(u["username"], PW)  # signed in before 2FA was turned on: no 2FA on this session
        await api.login(u["username"], PW)
        await enable_totp(api)  # enrolling verifies this device
        r = await older.post(
            "/api/v1/auth/change-password", json={"current_password": PW, "new_password": "Cobalt-Fern-Ridge-64"}
        )
        assert r.status_code == 403 and r.json()["code"] == "MfaRequired"
        assert (await older.c.post("/api/v1/auth/refresh")).status_code == 200  # refresh keeps the claim (still no 2FA)
        r = await older.post(
            "/api/v1/auth/change-password", json={"current_password": PW, "new_password": "Cobalt-Fern-Ridge-64"}
        )
        assert r.status_code == 403 and r.json()["code"] == "MfaRequired"
    ok(
        await api.post(
            "/api/v1/auth/change-password", json={"current_password": PW, "new_password": "Cobalt-Fern-Ridge-64"}
        )
    )
    assert "PASSWORD_CHANGE_FAILED" in await actions_for(u["id"])


async def test_mandatory_2fa_for_chosen_roles(api):
    u = await make_user(["FINANCE"])
    other = await make_user(["MARKETING"])
    await api.login("demo.admin")
    assert ok(await api.get("/api/v1/admin/security-policy"))["require_2fa_roles"] == []  # off by default
    assert (await api.put("/api/v1/admin/security-policy", json={"require_2fa_roles": ["FINANCE"]})).status_code == 422
    r = await api.put("/api/v1/admin/security-policy", json={"require_2fa_roles": ["NOPE"], "reason": "Policy test"})
    assert r.status_code == 422
    try:
        out = ok(
            await api.put(
                "/api/v1/admin/security-policy", json={"require_2fa_roles": ["FINANCE"], "reason": "Board decision"}
            )
        )
        assert out["require_2fa_roles"] == ["FINANCE"]
        me = ok(await login_raw(api, u["username"], PW))
        assert me["must_enroll_totp"]
        r = await api.get("/api/v1/finance/dashboard")
        assert r.status_code == 403 and r.json()["code"] == "TotpEnrolmentRequired"
        await enable_totp(api)
        assert (await api.get("/api/v1/finance/dashboard")).status_code == 200
        assert not ok(await login_raw(api, other["username"], PW))["must_enroll_totp"]  # other roles unaffected
    finally:
        await api.login("demo.admin")
        ok(await api.put("/api/v1/admin/security-policy", json={"require_2fa_roles": [], "reason": "Restore default"}))
    assert "TOTP_ENROLMENT_REQUIRED" in await actions_for(u["id"])


async def test_role_change_needs_a_reason_and_valid_roles(api):
    u = await make_user(["SALES"])
    await api.login("demo.admin")
    url = f"/api/v1/admin/users/{u['id']}/roles"
    assert (await api.put(url, {"roles": ["FINANCE"]})).status_code == 422
    assert (await api.put(url, {"roles": [], "reason": "Remove everything"})).status_code == 422
    r = await api.put(url, {"roles": ["NOT_A_ROLE"], "reason": "Typo check here"})
    assert r.status_code == 422 and r.json()["code"] == "UnknownRole"
    assert ok(await api.put(url, {"roles": ["FINANCE", "SALES"], "reason": "Covers the finance desk"}))["roles"] == [
        "FINANCE",
        "SALES",
    ]
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        summary = (
            (
                await s.execute(
                    text(
                        "SELECT summary FROM activity_log WHERE action = 'PERMISSION_CHANGE' AND entity_id = :i "
                        "ORDER BY seq DESC"
                    ),
                    {"i": u["id"]},
                )
            )
            .scalars()
            .first()
        )
    assert "Covers the finance desk" in summary and "SALES to FINANCE, SALES" in summary
