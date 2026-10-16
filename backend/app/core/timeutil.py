"""Time helpers. Store UTC, display Asia/Kolkata, DD-MM-YYYY."""

from collections.abc import Collection
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now_utc() -> datetime:
    return datetime.now(UTC)


def today_ist() -> date:
    return datetime.now(IST).date()


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
