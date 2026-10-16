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
    "finance.default_notice_days": 14,
    "finance.emi_due_day": 1,
    "member.require_signed_agreement": True,
    "member.min_kyc_ids_per_applicant": 1,
    "member.min_applicant_age": 18,
    "documents.max_upload_mb": 15,
    "documents.allowed_types": ["application/pdf", "image/jpeg", "image/png"],
    "kyc.aadhaar_full_storage": False,
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
