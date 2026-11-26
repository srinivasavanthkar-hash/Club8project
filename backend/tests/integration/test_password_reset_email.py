"""Password reset by email (docs/PASSWORD_PROMPT.md Phase 2): enumeration safety, tokens, limits, CAPTCHA, 2FA on the
reset form, session revocation, admin option A, notifications, APP_BASE_URL links and log hygiene.
Emails go to app.email.sender.OUTBOX (CRM_EMAIL_PROVIDER=memory). Fictitious users only."""

import hashlib
import logging
import re
import time
import uuid
from datetime import timedelta

import pyotp
import pytest
from sqlalchemy import text, update

from app.core.timeutil import real_now_utc
from app.email import dispatch
from app.email.sender import OUTBOX
from tests.integration.helpers import ok
from tests.integration.test_passwords import PW, actions_for, device, enable_totp, login_raw

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_limits():
    from app.core.ratelimit import reset_account_limits

    await reset_account_limits()
    OUTBOX.clear()
    yield
    await dispatch.drain()
    await reset_account_limits()


async def user_with_email(roles: list[str] | None = None, *, active: bool = True, email: bool = True) -> dict:
    from app.admin.service import create_user
    from app.auth.models import User
    from app.core.db import sessionmaker

    name = f"mail.{uuid.uuid4().hex[:6]}"
    addr = f"{name}@example.test" if email else None
    async with sessionmaker()() as s:
        u, _ = await create_user(s, name, "Mail Person", roles or ["SALES"], addr, password=PW)
        await s.commit()
    if not active:
        async with sessionmaker()() as s:
            await s.execute(update(User).where(User.id == u.id).values(is_active=False))
            await s.commit()
    return {"id": str(u.id), "username": name, "email": addr}


async def forgot(api, identifier: str, **extra) -> tuple[int, dict, float]:
    t0 = time.monotonic()
    api.c.cookies.clear()
    r = await api.c.post("/api/v1/auth/forgot-password", json={"identifier": identifier, **extra})
    return r.status_code, r.json(), time.monotonic() - t0


def mails_to(addr: str) -> list:
    return [m for m in OUTBOX if m.to == addr]


def token_from(msg) -> str:
    m = re.search(r"/reset-password\?token=([A-Za-z0-9_-]+)", msg.text)
    assert m, "no reset link in the email"
    return m.group(1)


async def check(api, token: str) -> dict:
    api.c.cookies.clear()  # the reset page is used signed out
    return ok(await api.c.post("/api/v1/auth/reset-password/check", json={"token": token}))


async def complete(api, token: str, new: str, code: str | None = None):
    api.c.cookies.clear()  # the reset page is used signed out
    body = {"token": token, "new_password": new}
    if code:
        body["totp_code"] = code
    return await api.c.post("/api/v1/auth/reset-password", json=body)


async def test_forgot_password_gives_the_same_answer_for_any_account(api):
    u = await user_with_email()
    inactive = await user_with_email(active=False)
    no_email = await user_with_email(email=False)
    answers = []
    for ident in (
        u["username"],
        u["email"].upper(),  # registered email, typed in another case
        "nobody.here",
        "nobody@example.test",
        inactive["username"],
        no_email["username"],
    ):
        status, body, secs = await forgot(api, ident)
        answers.append((status, body))
        assert secs >= 0.6, f"answered too fast for {ident}"
    assert len(set(map(str, answers))) == 1 and answers[0][0] == 202
    assert "If an account matches" in answers[0][1]["message"]
    await dispatch.drain()
    assert [m.to for m in OUTBOX] == [u["email"], u["email"]]  # registered address only, never the typed one
    assert not mails_to(inactive["email"])
    log = await actions_for(inactive["id"])
    assert "FORGOT_PASSWORD_REQUESTED" in log  # logged, nothing sent


async def test_tokens_hashed_single_use_expiring_and_replaced_by_newer(api):
    from app.auth.models import PasswordResetToken
    from app.core.db import sessionmaker

    u = await user_with_email()
    await forgot(api, u["username"])
    await forgot(api, u["username"])
    await dispatch.drain()
    first, second = (token_from(m) for m in mails_to(u["email"]))
    async with sessionmaker()() as s:
        stored = list((await s.execute(text("SELECT token_hash FROM password_reset_tokens"))).scalars())
    assert hashlib.sha256(second.encode()).hexdigest() in stored and second not in stored  # only the hash
    assert (await check(api, first))["valid"] is False  # a newer request invalidated it
    info = await check(api, second)
    assert info["valid"] and info["username"] == u["username"] and info["policy"]["min_length"] == 12
    r = await complete(api, second, "password1234")
    assert r.status_code == 422 and r.json()["problems"][0]["code"] == "Breached"
    assert (await complete(api, second, "Lantern-Quay-Heron-31")).status_code == 204
    r = await complete(api, second, "Another-Fresh-Phrase-77")
    assert r.status_code == 422 and r.json()["detail"] == "This reset link is invalid or has expired."  # single use
    await forgot(api, u["username"])
    await dispatch.drain()
    third = token_from(mails_to(u["email"])[-1])
    async with sessionmaker()() as s:
        await s.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.token_hash == hashlib.sha256(third.encode()).hexdigest())
            .values(expires_at=real_now_utc() - timedelta(seconds=1))
        )
        await s.commit()
    assert (await check(api, third))["valid"] is False  # expired
    assert (await check(api, "not-a-real-token-at-all"))["valid"] is False
    assert "RESET_LINK_INVALID" in await actions_for(u["id"])


async def test_reset_ends_sessions_clears_lockout_and_notifies(api):
    u = await user_with_email()
    async with device() as phone:
        await phone.login(u["username"], PW)
        for _ in range(5):
            await login_raw(api, u["username"], "wrong-password")
        r = await login_raw(api, u["username"], PW)
        assert r.json()["code"] == "AccountLocked"
        await forgot(api, u["email"])
        await dispatch.drain()
        assert (await complete(api, token_from(mails_to(u["email"])[-1]), "Willow-Signal-Harbor-42")).status_code == 204
        assert (await phone.get("/api/v1/members")).status_code == 401  # every session ended
    assert "crm_access" not in api.c.cookies  # not signed in automatically
    ok(await login_raw(api, u["username"], "Willow-Signal-Harbor-42"))  # lockout cleared
    await dispatch.drain()
    notice = mails_to(u["email"])[-1]
    assert "Your password was changed" in notice.subject and "If this wasn't you" in notice.text
    log = await actions_for(u["id"])
    for a in ("PASSWORD_RESET_COMPLETED", "LOCKOUT_CLEARED", "SESSIONS_REVOKED", "EMAIL_SENT"):
        assert a in log, a


async def test_reset_form_requires_2fa_when_enabled(api):
    u = await user_with_email()
    await api.login(u["username"], PW)
    secret = await enable_totp(api)
    await forgot(api, u["username"])
    await dispatch.drain()
    token = token_from(mails_to(u["email"])[-1])
    assert "authenticator app" in mails_to(u["email"])[-1].text
    assert (await check(api, token))["requires_totp"] is True
    r = await complete(api, token, "Meadow-Cinder-Falcon-56")
    assert r.status_code == 401 and r.json()["code"] == "TotpRequired"
    r = await complete(api, token, "Meadow-Cinder-Falcon-56", "000000")
    assert r.status_code == 401 and r.json()["code"] == "TotpInvalid"
    assert (await complete(api, token, "Meadow-Cinder-Falcon-56", pyotp.TOTP(secret).now())).status_code == 204
    r = await login_raw(api, u["username"], "Meadow-Cinder-Falcon-56")
    assert r.json()["code"] == "TotpRequired"  # 2FA still on after the reset


async def test_links_are_built_from_app_base_url_not_the_host_header(api):
    u = await user_with_email()
    api.c.cookies.clear()
    r = await api.c.post(
        "/api/v1/auth/forgot-password",
        json={"identifier": u["username"]},
        headers={"Host": "evil.example", "X-Forwarded-Host": "evil.example"},
    )
    assert r.status_code == 202
    await dispatch.drain()
    msg = mails_to(u["email"])[-1]
    assert "https://crm.club8.example/reset-password?token=" in msg.text and "evil.example" not in msg.html


async def test_forgot_limits_per_account_and_per_ip(api):
    u = await user_with_email()
    for _ in range(4):
        assert (await forgot(api, u["username"]))[0] == 202
    await dispatch.drain()
    assert len(mails_to(u["email"])) == 3  # 3 per account per hour; the 4th gets the same answer, nothing sent
    from app.core.ratelimit import reset_account_limits

    await reset_account_limits()
    OUTBOX.clear()
    for i in range(10):
        await forgot(api, f"unknown.{i}")
    assert (await forgot(api, u["username"]))[0] == 202  # 11th from this IP: same answer, nothing sent
    await dispatch.drain()
    assert not mails_to(u["email"])
    assert (await actions_for(u["id"])).count("RATE_LIMITED") >= 1


async def test_captcha_after_three_requests_from_one_ip(api, monkeypatch):
    from app.auth import reset
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "captcha_provider", "turnstile")
    monkeypatch.setattr(s, "captcha_site_key", "site-key-demo")

    async def fake_verify(token):  # type: ignore[no-untyped-def]
        return token == "passed"

    monkeypatch.setattr(reset, "verify_captcha", fake_verify)
    cfg = ok(await api.c.get("/api/v1/auth/forgot-password/config"))
    assert cfg == {"captcha_provider": "turnstile", "captcha_site_key": "site-key-demo"}
    for i in range(3):
        assert (await forgot(api, f"someone.{i}"))[0] == 202
    status, body, _ = await forgot(api, "someone.else")
    assert status == 428 and body["code"] == "CaptchaRequired" and body["site_key"] == "site-key-demo"
    assert (await forgot(api, "someone.else", captcha_token="wrong"))[0] == 428
    assert (await forgot(api, "someone.else", captcha_token="passed"))[0] == 202


async def test_admin_option_a_sends_a_link_and_notifications_never_contain_passwords(api):
    u = await user_with_email()
    no_mail = await user_with_email(email=False)
    async with device() as phone:
        await phone.login(u["username"], PW)
        await api.login("demo.admin")
        out = ok(
            await api.post(
                f"/api/v1/admin/users/{u['id']}/reset-password",
                json={"reason": "Locked out; asked for a link", "method": "EMAIL_LINK"},
            )
        )
        assert out["status"] == "LINK_SENT" and out["temporary_password"] is None
        assert out["link_sent_to"].startswith("m***@")
        assert (await phone.get("/api/v1/members")).status_code == 401  # option A also ends every session
    r = await api.post(
        f"/api/v1/admin/users/{no_mail['id']}/reset-password", json={"reason": "No email here", "method": "EMAIL_LINK"}
    )
    assert r.status_code == 409 and r.json()["code"] == "NoEmail"
    await dispatch.drain()
    link_mail = mails_to(u["email"])[-1]
    assert "An administrator has sent you a link" in link_mail.text
    assert (await complete(api, token_from(link_mail), "Juniper-Anchor-Tide-24")).status_code == 204

    # option B: the notice tells the user, but never contains the temporary password
    await api.login("demo.admin")
    temp = ok(
        await api.post(f"/api/v1/admin/users/{u['id']}/reset-password", json={"reason": "Prefers a temporary one"})
    )["temporary_password"]
    await dispatch.drain()
    notice = mails_to(u["email"])[-1]
    assert notice.subject.startswith("An administrator reset your password")
    assert temp not in notice.text and temp not in notice.html
    assert "PASSWORD_RESET_BY_ADMIN" in await actions_for(u["id"])


async def test_admin_link_for_an_admin_needs_approval(api):
    from tests.integration.test_passwords import make_user

    target = await user_with_email(["ADMIN"])
    approver = await make_user(["ADMIN"], prefix="adm")
    await api.login("demo.admin")
    out = ok(
        await api.post(
            f"/api/v1/admin/users/{target['id']}/reset-password",
            json={"reason": "Admin asked for a link", "method": "EMAIL_LINK"},
        )
    )
    assert out["status"] == "PENDING_APPROVAL"
    assert (
        next(r for r in ok(await api.get("/api/v1/admin/reset-requests")) if r["id"] == out["request_id"])["method"]
        == "EMAIL_LINK"
    )
    await api.login(approver["username"], PW)
    res = ok(
        await api.post(
            f"/api/v1/admin/reset-requests/{out['request_id']}/approve", json={"reason": "Confirmed in person"}
        )
    )
    assert res["status"] == "LINK_SENT"
    await dispatch.drain()
    assert mails_to(target["email"])


async def test_failed_email_never_changes_the_response(api, monkeypatch):
    from app.email import sender

    u = await user_with_email()

    class Broken:
        async def send(self, msg):  # type: ignore[no-untyped-def]
            raise ConnectionError("smtp down")

    monkeypatch.setattr(dispatch, "get_sender", lambda: Broken())
    monkeypatch.setattr(dispatch, "BACKOFF_SECONDS", 0)
    status, body, _ = await forgot(api, u["username"])
    assert status == 202 and "If an account matches" in body["message"]
    await dispatch.drain()
    assert not sender.OUTBOX
    assert "EMAIL_FAILED" in await actions_for(u["id"])


async def test_no_reset_token_or_password_in_logs_or_activity_log(api, caplog):
    from tests.integration.test_passwords import _max_seq

    caplog.set_level(logging.DEBUG)
    start = await _max_seq()
    u = await user_with_email()
    await forgot(api, u["username"])
    await dispatch.drain()
    token = token_from(mails_to(u["email"])[-1])
    await check(api, token)
    assert (await complete(api, token, "Secret-Marker-Reset-88")).status_code == 204
    await complete(api, token, "Secret-Marker-Reset-89")  # reused: refused
    logging.getLogger("crm.test").info("debug dump https://x/reset-password?token=%s", token)
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        persisted = "\n".join(
            (
                await s.execute(
                    text(
                        "SELECT coalesce(summary,'') || ' ' || coalesce(changes::text,'') "
                        "FROM activity_log WHERE seq > :s"
                    ),
                    {"s": start},
                )
            ).scalars()
        )
    for secret in (token, "Secret-Marker-Reset-88", "Secret-Marker-Reset-89"):
        assert secret not in persisted
        assert secret not in caplog.text
