"""Time helpers. Store UTC, display Asia/Kolkata, DD-MM-YYYY."""

from collections.abc import Collection
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def _fixed_shift() -> timedelta:
    """Whole days between the fixed business date (CRM_FIXED_TODAY: tests and throwaway e2e stacks only, refused in
    staging and prod; core/config.py) and the real date in India. Zero when it is not set."""
    from app.core.config import get_settings  # here, not at import: settings are read once they are set up

    fixed = get_settings().fixed_today
    return timedelta(0) if fixed is None else fixed - datetime.now(IST).date()


def now_utc() -> datetime:
    """Business clock: event timestamps (created, confirmed, approved, received ...), on the fixed business date when
    one is set, so dates worked out from them agree with today_ist(). Not for anything checked against real time."""
    return datetime.now(UTC) + _fixed_shift()


def real_now_utc() -> datetime:
    """Real time, always: sign-in tokens, lockouts, reset links, approval windows and storage links, which browsers,
    token libraries and storage services check against the real clock."""
    return datetime.now(UTC)


def today_ist() -> date:
    """Business date in India (the fixed date when CRM_FIXED_TODAY is set)."""
    return now_utc().astimezone(IST).date()


def fmt_date(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def fmt_dt_ist(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%d-%m-%Y %H:%M")


def is_working_day(d: date, holidays: Collection[date], weekend: Collection[int] = (6,)) -> bool:
    """weekend uses date.weekday() numbering (Mon=0 .. Sun=6). Default: Sunday only (configurable)."""
    return d.weekday() not in weekend and d not in holidays


def add_working_days(start: date, n: int, holidays: Collection[date], weekend: Collection[int] = (6,)) -> date:
    d = start
    added = 0
    while added < n:
        d += timedelta(days=1)
        if is_working_day(d, holidays, weekend):
            added += 1
    return d


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    import calendar

    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)
