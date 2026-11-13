"""Password policy (docs/PASSWORD_PROMPT.md Section 5, aligned with NIST SP 800-63B).

Length and screening only: no composition rules ("must include a symbol") and no periodic expiry. Every value comes
from system_settings (Admin -> Master data -> Business-rule settings), with the defaults in core/settings_store.py.
The server is the only enforcer; the strength meter in the browser is guidance.
"""

from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.breach import is_breached
from app.auth.models import PasswordHistory, User
from app.core.security import verify_password
from app.core.settings_store import get_settings_map

KEYS = [
    "password.min_length",
    "password.max_length",
    "password.history_count",
    "password.forbidden_words",
    "password.breach_check",
]


@dataclass(frozen=True)
class Problem:
    code: str
    message: str


def _norm(s: str) -> str:
    """Lower-case with spaces, dots, dashes and underscores removed, so "Demo Admin" also catches "demo_admin"."""
    return re.sub(r"[\s._-]+", "", s.lower())


def personal_words(username: str, full_name: str, extra: list[str]) -> list[str]:
    words = {_norm(username)} | {_norm(w) for w in extra}
    words |= {_norm(part) for part in re.split(r"[\s._-]+", full_name) if len(part) >= 3}
    words |= {_norm(part) for part in re.split(r"[._-]+", username) if len(part) >= 3}
    return sorted(w for w in words if w)


def static_problems(password: str, username: str, full_name: str, cfg: dict[str, object]) -> list[Problem]:
    """Checks that need no database or network (also used for generated temporary passwords)."""
    out: list[Problem] = []
    min_len, max_len = int(cfg["password.min_length"]), int(cfg["password.max_length"])  # type: ignore[call-overload]
    if len(password) < min_len:
        out.append(Problem("TooShort", f"Use at least {min_len} characters. A few unrelated words make a good one."))
    if len(password) > max_len:
        out.append(Problem("TooLong", f"Use at most {max_len} characters."))
    if not password.isprintable():
        out.append(Problem("Unprintable", "Use letters, numbers, spaces and symbols only."))
    flat = _norm(password)
    forbidden = [str(w) for w in cfg["password.forbidden_words"]]  # type: ignore[attr-defined]
    for word in personal_words(username, full_name, forbidden):
        if word in flat:
            what = "the company name" if word in {_norm(w) for w in forbidden} else "your username or name"
            out.append(Problem("ContainsPersonal", f"Don't include {what} in your password."))
            break
    return out


async def policy_problems(
    session: AsyncSession, password: str, *, username: str, full_name: str, user: User | None = None
) -> list[Problem]:
    cfg = await get_settings_map(session, KEYS)
    out = static_problems(password, username, full_name, cfg)
    if out and any(p.code in ("TooShort", "TooLong") for p in out):
        return out  # no point screening a password that will be rejected anyway
    if user is not None and await reused(session, user, password, int(cfg["password.history_count"])):
        out.append(Problem("Reused", "You've used this password recently. Choose one you haven't used before."))
    if cfg["password.breach_check"]:
        result = await is_breached(password)
        if result.breached:
            out.append(Problem("Breached", "This password has appeared in a data breach. Choose a different one."))
    return out


async def reused(session: AsyncSession, user: User, password: str, count: int) -> bool:
    """The current password plus the last `count` self-chosen ones (bcrypt hashes only)."""
    if verify_password(password, user.password_hash):
        return True
    hashes = (
        await session.execute(
            select(PasswordHistory.password_hash)
            .where(PasswordHistory.user_id == user.id)
            .order_by(PasswordHistory.created_at.desc())
            .limit(count)
        )
    ).scalars()
    return any(verify_password(password, h) for h in hashes)


async def remember(session: AsyncSession, user_id: uuid.UUID, password_hash: str, count: int) -> None:
    """Add a hash to the history and keep only the newest `count` entries."""
    session.add(PasswordHistory(user_id=user_id, password_hash=password_hash))
    await session.flush()
    old = (
        await session.execute(
            select(PasswordHistory)
            .where(PasswordHistory.user_id == user_id)
            .order_by(PasswordHistory.created_at.desc())
            .offset(count)
        )
    ).scalars()
    for row in old:
        await session.delete(row)


# Unambiguous characters only (no 0/O, 1/l/I), so a temporary password can be read out over the phone.
_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_temporary_password(username: str, full_name: str, cfg: dict[str, object]) -> str:
    """4 groups of 5 characters: about 115 bits of entropy, e.g. "hT7qm-Xc4Pz-9wRnb-K2vYe"."""
    while True:
        pw = "-".join("".join(secrets.choice(_ALPHABET) for _ in range(5)) for _ in range(4))
        if not static_problems(pw, username, full_name, cfg):
            return pw
