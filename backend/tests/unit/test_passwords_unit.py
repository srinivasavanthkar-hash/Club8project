"""Password policy, temporary passwords, breached-password screening and log scrubbing (no database)."""

import hashlib
import logging

import httpx
import pytest

from app.auth import breach
from app.auth.policy import generate_temporary_password, personal_words, static_problems
from app.core.config import get_settings
from app.core.logscrub import REDACTED, install, scrub
from app.core.settings_store import DEFAULTS

CFG = {k: v for k, v in DEFAULTS.items() if k.startswith("password.")}


def codes(password: str, username: str = "priya.demo", full_name: str = "Priya Demo") -> list[str]:
    return [p.code for p in static_problems(password, username, full_name, CFG)]


def test_length_only_no_composition_rules():
    assert codes("short pass") == ["TooShort"]
    assert codes("x" * 129) == ["TooLong"]
    assert codes("all lowercase words here") == []  # no symbol/upper/digit rules (NIST SP 800-63B)
    assert codes("tab\tinside password") == ["Unprintable"]


@pytest.mark.parametrize(
    "password",
    ["my-priya-garden-2026", "PRIYA_DEMO is here", "I love Club8 holidays", "k8 is our brand!!", "priyademo123456"],
)
def test_rejects_username_name_and_company_words(password):
    assert "ContainsPersonal" in codes(password)


def test_name_parts_shorter_than_three_letters_are_ignored():
    assert "al" not in personal_words("al.x", "Al X", [])
    assert codes("totally alright passphrase", "al.x", "Al X") == []


def test_generated_temporary_password_is_strong_and_policy_clean():
    seen = set()
    for _ in range(200):
        pw = generate_temporary_password("demo.k8user", "K8 User", CFG)
        assert len(pw) == 23 and pw.count("-") == 3
        assert not static_problems(pw, "demo.k8user", "K8 User", CFG)
        assert not set(pw) & set("0O1lI")  # readable over the phone
        seen.add(pw)
    assert len(seen) == 200


def _hibp_transport(password: str, hits: int, captured: list[httpx.Request]) -> httpx.MockTransport:
    digest = hashlib.sha1(password.encode()).hexdigest().upper()

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        body = f"0000000000000000000000000000000000A:3\r\n{digest[5:]}:{hits}\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0"
        return httpx.Response(200, text=body)

    return httpx.MockTransport(handler)


async def test_hibp_sends_only_a_five_character_prefix(monkeypatch):
    monkeypatch.setattr(get_settings(), "password_breach_api_enabled", True)
    password = "Unusual-Phrase-For-Test-1"
    captured: list[httpx.Request] = []
    result = await breach.is_breached(password, transport=_hibp_transport(password, 42, captured))
    assert result == breach.BreachResult(True, "hibp")
    (req,) = captured
    digest = hashlib.sha1(password.encode()).hexdigest().upper()
    assert str(req.url).endswith("/range/" + digest[:5])
    assert digest[5:] not in str(req.url) and password not in str(req.url)
    assert req.headers["Add-Padding"] == "true"


async def test_hibp_padding_rows_are_not_matches(monkeypatch):
    monkeypatch.setattr(get_settings(), "password_breach_api_enabled", True)
    password = "Another-Unusual-Phrase-2"
    result = await breach.is_breached(password, transport=_hibp_transport(password, 0, []))
    assert result == breach.BreachResult(False, "hibp")


async def test_api_unreachable_falls_back_to_offline_list_without_blocking(monkeypatch, caplog):
    monkeypatch.setattr(get_settings(), "password_breach_api_enabled", True)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable")

    t = httpx.MockTransport(down)
    assert await breach.is_breached("password1234", transport=t) == breach.BreachResult(True, "offline")
    assert await breach.is_breached("Quiet-Lantern-River-42", transport=t) == breach.BreachResult(False, "offline")
    assert "password1234" not in caplog.text


def test_scrub_patterns():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl"
    text = (
        f'{{"password": "Hunter-2-Secret", "new_password": "Next-Secret-9"}} token={jwt} '
        f"Authorization: Bearer abc.def.ghi crm_refresh={jwt}; current_password=Plain-Old-1 totp_code=123456"
    )
    out = scrub(text)
    for secret in ("Hunter-2-Secret", "Next-Secret-9", jwt, "abc.def.ghi", "Plain-Old-1", "123456"):
        assert secret not in out
    assert out.count(REDACTED) >= 6


def test_log_records_are_scrubbed_before_any_handler(caplog):
    install()
    log = logging.getLogger("crm.test")
    with caplog.at_level(logging.INFO):
        log.info("login payload %s", {"username": "demo.sales", "password": "Do-Not-Log-Me-1"})
        log.info("extra fields", extra={"new_password": "Do-Not-Log-Me-2", "detail": "token=abc123secret"})
    assert "Do-Not-Log-Me-1" not in caplog.text and "demo.sales" in caplog.text
    rec = caplog.records[-1]
    assert rec.new_password == REDACTED  # type: ignore[attr-defined]
    assert "abc123secret" not in rec.detail  # type: ignore[attr-defined]
