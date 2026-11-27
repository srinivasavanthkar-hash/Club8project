"""Passwords (bcrypt), JWT access/refresh tokens, TOTP."""

import secrets
import uuid
from datetime import timedelta
from typing import Any

import bcrypt
import jwt
import pyotp

from app.core.config import get_settings
from app.core.timeutil import real_now_utc


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# Constant-time dummy check so unknown usernames take as long as wrong passwords.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt(rounds=12)).decode()


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


def create_token(user_id: uuid.UUID, kind: str, ttl: timedelta, extra: dict[str, Any] | None = None) -> tuple[str, str]:
    s = get_settings()
    jti = secrets.token_hex(16)
    now = real_now_utc()
    payload = {"sub": str(user_id), "typ": kind, "jti": jti, "iat": now, "exp": now + ttl, **(extra or {})}
    return jwt.encode(payload, s.jwt_signing_key.get_secret_value(), algorithm=s.jwt_algorithm), jti


def decode_token(token: str, kind: str) -> dict[str, Any]:
    s = get_settings()
    data: dict[str, Any] = jwt.decode(token, s.jwt_signing_key.get_secret_value(), algorithms=[s.jwt_algorithm])
    if data.get("typ") != kind:
        raise jwt.InvalidTokenError("wrong token type")
    return data


def new_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def totp_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="Club8 CRM")
