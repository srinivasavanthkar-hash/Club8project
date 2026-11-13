from typing import cast

from limits import parse
from limits.aio.storage import Storage
from limits.aio.strategies import MovingWindowRateLimiter
from limits.storage import storage_from_string
from slowapi import Limiter

from app.core.config import get_settings
from app.core.middleware import client_ip


def _key(request) -> str:  # type: ignore[no-untyped-def]
    return client_ip(request) or "anon"


def _storage() -> str:
    s = get_settings()
    return "memory://" if s.env in ("local", "test") else s.redis_url


# Per client IP, applied with @limiter.limit(...) on routes (slowapi, Redis-backed outside local/test).
limiter = Limiter(key_func=_key, storage_uri=_storage(), default_limits=[get_settings().rate_limit_default])

_account_storage: Storage | None = None


def _account_limiter() -> MovingWindowRateLimiter:
    global _account_storage
    if _account_storage is None:
        uri = _storage()
        if uri.startswith("redis"):  # same Redis as slowapi, through redis-py (already a dependency)
            _account_storage = cast(Storage, storage_from_string("async+" + uri, implementation="redispy"))
        else:
            _account_storage = cast(Storage, storage_from_string("async+memory://"))
    return MovingWindowRateLimiter(_account_storage)


async def hit_account(scope: str, account: str, limit: str) -> bool:
    """Per-account limit (e.g. login attempts for one username from any IP). Returns False once over the limit.

    The key holds the scope and the normalised account name only, never a password or token."""
    return await _account_limiter().hit(parse(limit), scope, account.strip().lower()[:80])


async def reset_account_limits() -> None:
    """Tests only: clear the per-account counters."""
    if _account_storage is not None:
        await _account_storage.reset()
