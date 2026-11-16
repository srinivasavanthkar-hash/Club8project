"""Business-rule parameters stored in `system_settings`. Defaults here are the seed values only.

Every key is documented in docs/BUSINESS_RULES.md.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import SystemSetting

DEFAULTS: dict[str, Any] = {
    "booking.min_working_days": 7,
    "booking.max_months": 12,
    "booking.weekend_days": [6],  # date.weekday(): Sunday
    "reservation.max_reschedules": 2,
    "entitlement.save_years": 2,
    "entitlement.borrow_years": 2,
    "entitlement.consumption_order": ["SAVED", "CURRENT", "BORROWED"],
    "entitlement.deduction_rounding": "UP",
    "asf.charge_unraised_saved_source": True,
    "asf.annual_cap_percent": "5",
    # D-33: withdraw an unpaid ASF when its only booking is cancelled or declined (paid ASF is never touched)
    "asf.withdraw_unpaid_on_cancel": True,
    "finance.default_notice_days": 14,
    "finance.emi_due_day": 1,
    "member.require_signed_agreement": True,
    "member.min_kyc_ids_per_applicant": 1,
    "member.min_applicant_age": 18,
    "documents.max_upload_mb": 15,
    "documents.allowed_types": ["application/pdf", "image/jpeg", "image/png"],
    "kyc.aadhaar_full_storage": False,
    # Password policy (docs/PASSWORD_PROMPT.md Section 5, NIST SP 800-63B): length and screening, no composition
    # rules, no periodic expiry.
    "password.min_length": 12,
    "password.max_length": 128,
    "password.history_count": 5,
    "password.forbidden_words": ["club8", "k8"],
    "password.breach_check": True,
    "password.temp_expiry_hours": 24,
    "password.admin_reset_approval_hours": 24,
    # Roles that must use two-step verification; users in them enrol at their next sign-in. Off by default
    # (OPEN_QUESTIONS 30); recommended: ["ADMIN", "MANAGEMENT", "FINANCE"].
    "security.require_2fa_roles": [],
    # Self-service reset (Section 2)
    "password.reset_token_minutes": 30,
    "password.forgot_per_account_per_hour": 3,
    "password.forgot_per_ip_per_hour": 10,
    "password.captcha_after_per_ip_per_hour": 3,
}


async def get_setting(session: AsyncSession, key: str) -> Any:
    row = (await session.execute(select(SystemSetting.value).where(SystemSetting.key == key))).scalar_one_or_none()
    if row is None:
        if key not in DEFAULTS:
            raise KeyError(key)
        return DEFAULTS[key]
    return row


async def get_settings_map(session: AsyncSession, keys: list[str]) -> dict[str, Any]:
    rows: dict[str, Any] = dict(
        (await session.execute(select(SystemSetting.key, SystemSetting.value).where(SystemSetting.key.in_(keys)))).all()
    )
    return {k: rows.get(k, DEFAULTS.get(k)) for k in keys}
