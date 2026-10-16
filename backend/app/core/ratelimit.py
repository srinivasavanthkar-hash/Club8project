from slowapi import Limiter

from app.core.config import get_settings
from app.core.middleware import client_ip


def _key(request) -> str:  # type: ignore[no-untyped-def]
    return client_ip(request) or "anon"


def _storage() -> str:
    s = get_settings()
    return "memory://" if s.env in ("local", "test") else s.redis_url


limiter = Limiter(key_func=_key, storage_uri=_storage(), default_limits=[get_settings().rate_limit_default])
