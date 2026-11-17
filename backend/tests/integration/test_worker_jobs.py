"""Background jobs as the Dramatiq worker runs them: each job in its own thread-local `asyncio.run`, several different
jobs back to back in one worker process, and two worker threads at once (docker-compose: --threads 2).

Before each job had its own engine (app.core.db.job_engine), jobs shared the app's connection pool across event loops
and failed with "attached to a different loop" / "Event loop is closed", succeeding only on a later retry."""

import asyncio
import threading
import uuid
from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from app.email.sender import OUTBOX

pytestmark = pytest.mark.integration


def _email_job(tag: str) -> dict:
    return {
        "to": f"worker.{tag}@example.test",
        "template": "security_notice",
        "subject": f"Worker job test {tag}",
        "context": {"name": "Demo Worker", "username": f"worker.{tag}", "what": "Worker job test", "when": "now"},
        "user_id": str(uuid.uuid4()),
        "username": f"worker.{tag}",
        "kind": "SECURITY_NOTICE",
    }


def _jobs(tag: str) -> list[tuple[str, Callable[[], None]]]:
    from app.jobs import tasks

    return [
        ("mark_overdue_instalments", tasks.mark_overdue_instalments.fn),
        ("expire_saved_nights", tasks.expire_saved_nights.fn),
        ("send_email", lambda: tasks.send_email.fn(_email_job(tag))),
        ("expire_memberships", tasks.expire_memberships.fn),
        ("refresh_scan_results", tasks.refresh_scan_results.fn),
        ("expire_account_recovery", tasks.expire_account_recovery.fn),
        ("expire_saved_nights again", tasks.expire_saved_nights.fn),
    ]


def _worker_thread(jobs: list[tuple[str, Callable[[], None]]], failures: list[str]) -> None:
    """One Dramatiq worker thread: runs each job once, in order, and notes any that raised (no retries here)."""
    for name, fn in jobs:
        try:
            fn()
        except Exception as e:
            failures.append(f"{name}: {type(e).__name__}: {e}")


WORKER_DEADLINE_S = 90


async def _run_workers(*job_lists: list[tuple[str, Callable[[], None]]]) -> list[str]:
    """Runs one worker thread per job list at once; a job stuck on another loop's connection counts as a failure
    (daemon threads, so a hang fails the test instead of blocking it)."""
    failures: list[str] = []
    threads = [threading.Thread(target=_worker_thread, args=(jobs, failures), daemon=True) for jobs in job_lists]

    def run() -> None:
        for t in threads:
            t.start()
        for t in threads:
            t.join(WORKER_DEADLINE_S)

    await asyncio.to_thread(run)
    stuck = [f"worker thread {i + 1} still running after {WORKER_DEADLINE_S} s" for i, t in enumerate(threads)]
    return failures + [msg for msg, t in zip(stuck, threads, strict=True) if t.is_alive()]


async def _sent(engine: AsyncEngine, username: str) -> bool:
    from app.audit.models import ActivityLog
    from app.core.db import sessionmaker

    async with sessionmaker()() as s:
        row = await s.scalar(
            select(ActivityLog).where(ActivityLog.action == "EMAIL_SENT", ActivityLog.entity_ref == username)
        )
    return row is not None


async def test_jobs_back_to_back_in_one_worker_thread(engine: AsyncEngine) -> None:
    OUTBOX.clear()
    # the test's own event loop (and the app engine's pool) stays alive meanwhile, as the API's would
    failures = await _run_workers(_jobs("seq"))
    assert failures == [], "jobs failed on the first try:\n" + "\n".join(failures)
    assert [m.subject for m in OUTBOX] == ["Worker job test seq"]
    assert await _sent(engine, "worker.seq"), "the email job did not record EMAIL_SENT"


async def test_jobs_in_two_worker_threads_at_once(engine: AsyncEngine) -> None:
    OUTBOX.clear()
    failures = await _run_workers(_jobs("t1"), list(reversed(_jobs("t2"))))
    assert failures == [], "jobs failed on the first try:\n" + "\n".join(failures)
    assert sorted(m.subject for m in OUTBOX) == ["Worker job test t1", "Worker job test t2"]
    assert await _sent(engine, "worker.t1") and await _sent(engine, "worker.t2")


async def test_job_engine_is_closed_and_app_sessions_unchanged(engine: AsyncEngine) -> None:
    """After a job, sessionmaker() is the app's again (the job's engine is not left behind)."""
    from app.core.db import job_engine, sessionmaker

    app_sm = sessionmaker()

    def job() -> tuple[bool, bool]:
        async def inside() -> tuple[bool, bool]:
            async with job_engine() as eng:
                return sessionmaker() is not app_sm, sessionmaker().kw["bind"] is eng

        return asyncio.run(inside())

    differs, bound = await asyncio.to_thread(job)
    assert differs and bound
    assert sessionmaker() is app_sm
