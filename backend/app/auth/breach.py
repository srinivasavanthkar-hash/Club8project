"""Breached-password screening.

1. Have I Been Pwned "range" API with k-anonymity: only the first 5 hex characters of the password's SHA-1 hash are
   sent; the response lists hash suffixes, which are compared locally. The password never leaves the server.
2. If the API is disabled, slow or unreachable, the bundled offline list (data/common-passwords.txt.gz: SecLists
   "100k most used passwords (NCSC)", MIT licence) is used instead. The user is never blocked because the API is down.
"""

from __future__ import annotations

import gzip
import hashlib
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import get_settings

log = logging.getLogger("crm.auth")
_LIST = Path(__file__).parent / "data" / "common-passwords.txt.gz"


@dataclass(frozen=True)
class BreachResult:
    breached: bool
    source: str  # "hibp" or "offline" - recorded so operators can see when the API was unavailable


@lru_cache(maxsize=1)
def _offline() -> frozenset[str]:
    with gzip.open(_LIST, "rt", encoding="utf-8", errors="ignore") as f:
        return frozenset(line.strip().lower() for line in f if line.strip())


def offline_breached(password: str) -> bool:
    return password.lower() in _offline()


async def _hibp(password: str, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    s = get_settings()
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    async with httpx.AsyncClient(timeout=s.password_breach_api_timeout_seconds, transport=transport) as client:
        # Add-Padding hides the real number of matches from anyone watching the response size.
        r = await client.get(s.password_breach_api_url + prefix, headers={"Add-Padding": "true"})
        r.raise_for_status()
    for line in r.text.splitlines():
        sfx, _, count = line.partition(":")
        if sfx.strip().upper() == suffix and count.strip() not in ("", "0"):  # padding rows have a count of 0
            return True
    return False


async def is_breached(password: str, transport: httpx.AsyncBaseTransport | None = None) -> BreachResult:
    if get_settings().password_breach_api_enabled:
        try:
            return BreachResult(await _hibp(password, transport), "hibp")
        except (httpx.HTTPError, OSError) as e:
            # Never log the password or its hash; the exception type is enough to diagnose the outage.
            log.warning("Breached-password API unavailable (%s); using the offline list", type(e).__name__)
    return BreachResult(offline_breached(password), "offline")
