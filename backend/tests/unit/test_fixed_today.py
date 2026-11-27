"""CRM_FIXED_TODAY fixes the business date for tests and throwaway e2e stacks, and is refused in staging and prod."""

from datetime import UTC, date, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.core import timeutil
from app.core.config import Settings, get_settings


def test_backend_tests_run_on_a_fixed_date() -> None:
    assert get_settings().fixed_today == date(2026, 11, 16)
    assert timeutil.today_ist() == date(2026, 11, 16)


def test_event_timestamps_are_on_the_business_date() -> None:
    # dates worked out from event timestamps (confirmed on, received on) must agree with today_ist()
    assert timeutil.now_utc().astimezone(timeutil.IST).date() == date(2026, 11, 16)


def test_security_clocks_keep_real_time() -> None:
    # sign-in tokens, lockouts, reset links and storage links are checked against real time
    assert abs(timeutil.real_now_utc() - datetime.now(UTC)) < timedelta(seconds=5)
    shift = timeutil.now_utc() - timeutil.real_now_utc()
    assert abs(shift.total_seconds()) % 86400 < 5 or 86400 - abs(shift.total_seconds()) % 86400 < 5  # whole days


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_refused_in_staging_and_prod(env: str) -> None:
    with pytest.raises(ValidationError, match="CRM_FIXED_TODAY"):
        Settings(env=env, fixed_today=date(2026, 11, 16), pdf_engine="weasyprint")
