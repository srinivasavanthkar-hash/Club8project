"""Background jobs (Dramatiq + Redis). Every job is idempotent: running it twice changes nothing more.

Scheduled by app.jobs.scheduler (APScheduler, one leader) in the worker container:
  * mark_overdue_instalments  - daily 00:30 IST
  * expire_saved_nights       - daily 01:00 IST (only produces entries on/after 1 Jan)
  * expire_memberships        - daily 01:30 IST (ACTIVE -> EXPIRED after last year of use)
  * refresh_scan_results      - every 2 minutes (Defender malware verdicts from blob index tags)
  * expire_account_recovery   - every 15 minutes (unused temporary passwords, ADMIN reset requests)
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from typing import Any

import dramatiq
from dramatiq.brokers.redis import RedisBroker
from sqlalchemy import select

from app.audit.service import install_session_hooks
from app.core.config import get_settings
from app.core.context import RequestContext, set_context
from app.core.db import sessionmaker
from app.core.timeutil import today_ist

log = logging.getLogger("crm.jobs")
dramatiq.set_broker(RedisBroker(url=get_settings().redis_url))  # type: ignore[no-untyped-call]
install_session_hooks()


def _run(coro_fn: Callable[[], Coroutine[Any, Any, Any]]) -> Any:
    set_context(RequestContext(username="system:worker"))
    return asyncio.run(coro_fn())


async def _mark_overdue() -> int:
    from app.finance.service import mark_overdue

    async with sessionmaker()() as s:
        n = await mark_overdue(s, today_ist())
        await s.commit()
    return n


async def _expire_saved() -> int:
    from app.entitlement.service import expire_saved
    from app.members.models import Member

    count = 0
    async with sessionmaker()() as s:
        ids = list(
            (
                await s.execute(select(Member.id).where(Member.status.in_(["ACTIVE", "DEFAULT_NOTICE", "SUSPENDED"])))
            ).scalars()
        )
    for mid in ids:  # one transaction per member keeps locks short
        async with sessionmaker()() as s:
            member = await s.get(Member, mid)
            if member:
                count += len(await expire_saved(s, member, today_ist()))
                await s.commit()
    return count


async def _expire_memberships() -> int:
    from app.members.models import Member
    from app.members.status import set_status

    async with sessionmaker()() as s:
        rows = (
            (
                await s.execute(
                    select(Member)
                    .where(Member.status == "ACTIVE", Member.last_year_of_use < today_ist().year)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for m in rows:
            set_status(s, m, "EXPIRED", None, "Last year of use has passed")
        await s.commit()
    return len(rows)


async def _refresh_scans() -> int:
    from app.correspondence.documents import refresh_scan_results

    async with sessionmaker()() as s:
        n = await refresh_scan_results(s)
        await s.commit()
    return n


@dramatiq.actor(max_retries=3, time_limit=300_000)
def refresh_scan_results() -> None:
    log.info("documents released from quarantine / flagged: %s", _run(_refresh_scans))


@dramatiq.actor(max_retries=3, time_limit=600_000)
def mark_overdue_instalments() -> None:
    log.info("overdue instalments marked: %s", _run(_mark_overdue))


@dramatiq.actor(max_retries=3, time_limit=3_600_000)
def expire_saved_nights() -> None:
    log.info("saved-night buckets expired: %s", _run(_expire_saved))


@dramatiq.actor(max_retries=3, time_limit=600_000)
def expire_memberships() -> None:
    log.info("memberships expired: %s", _run(_expire_memberships))


async def _expire_account_recovery() -> tuple[int, int]:
    from app.auth.recovery import expire_reset_requests, expire_temporary_passwords

    async with sessionmaker()() as s:
        temps = await expire_temporary_passwords(s)
        requests = await expire_reset_requests(s)
        await s.commit()
    return temps, requests


@dramatiq.actor(max_retries=3, time_limit=300_000)
def expire_account_recovery() -> None:
    temps, requests = _run(_expire_account_recovery)
    log.info("temporary passwords expired: %s; admin reset requests expired: %s", temps, requests)
