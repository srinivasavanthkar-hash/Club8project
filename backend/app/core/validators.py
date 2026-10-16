"""India-default validators (patterns are configurable via system_settings; these are the defaults)."""

import re
from datetime import date

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
PIN_RE = re.compile(r"^[1-9][0-9]{5}$")
INDIAN_MOBILE_RE = re.compile(r"^[6-9][0-9]{9}$")
INTL_RE = re.compile(r"^\+[1-9][0-9]{6,14}$")

# Verhoeff tables
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_check_digit(number: str) -> str:
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return str(_INV[c])


def validate_aadhaar(raw: str) -> str:
    digits = re.sub(r"\s|-", "", raw)
    if len(digits) != 12 or not digits.isdigit():
        raise ValueError("Aadhaar must be 12 digits")
    if digits[0] in "01":
        raise ValueError("Aadhaar cannot start with 0 or 1")
    if not verhoeff_valid(digits):
        raise ValueError("Aadhaar checksum (Verhoeff) failed")
    return digits


def mask_aadhaar(digits: str) -> str:
    return f"XXXX-XXXX-{digits[-4:]}"


def mask_value(value: str, visible: int = 4) -> str:
    if len(value) <= visible:
        return "*" * len(value)
    return "*" * (len(value) - visible) + value[-visible:]


def validate_pan(raw: str) -> str:
    pan = raw.strip().upper()
    if not PAN_RE.match(pan):
        raise ValueError("PAN must match AAAAA9999A")
    return pan


def validate_pin(raw: str) -> str:
    pin = raw.strip()
    if not PIN_RE.match(pin):
        raise ValueError("PIN code must be 6 digits")
    return pin


def normalize_phone(raw: str | None) -> str | None:
    """Canonical storage/search form.

    Indian numbers -> 10 digits (strip spaces, punctuation, +91 / 91 / leading 0).
    International numbers -> '+<digits>'.
    """
    if raw is None:
        return None
    s = re.sub(r"[^\d+]", "", raw.strip())
    if not s:
        return None
    if s.startswith("+91"):
        s = s[3:]
    elif s.startswith("+"):
        return s
    elif s.startswith("0091"):
        s = s[4:]
    elif len(s) == 12 and s.startswith("91"):
        s = s[2:]
    s = s.lstrip("0") if len(s) == 11 and s.startswith("0") else s
    return s


def validate_mobile(raw: str) -> str:
    n = normalize_phone(raw)
    if n is None:
        raise ValueError("Mobile number required")
    if n.startswith("+"):
        if not INTL_RE.match(n):
            raise ValueError("International number must be +<country code><number>")
        return n
    if not INDIAN_MOBILE_RE.match(n):
        raise ValueError("Indian mobile must be 10 digits starting 6-9")
    return n


def age_on(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def validate_adult(dob: date, today: date, min_age: int = 18) -> date:
    if dob > today:
        raise ValueError("Date of birth is in the future")
    if age_on(dob, today) < min_age:
        raise ValueError(f"Applicant must be at least {min_age}")
    return dob


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().lower()


def normalize_email(email: str | None) -> str | None:
    return email.strip().lower() if email else None
