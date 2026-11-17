"""Recording-only helper for the follow-up clips (docs/DEMO_CLIPS_PROMPT.md, demo-video/src/clips.ts).

Two states the clips need that the API cannot produce on the day of recording:

  default-notice <member_id> <days_ago> <username>
      Issues a default notice dated <days_ago> days ago (clip 2: Meera, ready to terminate), by calling the app's own
      `issue_default_notice`. Only for that one call, `today` is patched in this short-lived process (option A,
      approved 17-11-2026): the API and worker processes always run on the real clock, and nothing is written to
      the tables by hand. The notice, its PDF, the status change and the activity-log entries are the app's own.

  mark-overdue
      Runs the app's daily job that marks past-due instalments OVERDUE (clip 2: Rohan), with the real clock, as the
      scheduler would. Without it the schedule would show PENDING until the next nightly run.

Refuses to run unless it is pointed at the recording database (crm_video) of a recording stack (CRM_E2E_TARGET=true,
CRM_ENV local or test): never crm_local, a demo database people use, staging or prod.

    python demo-video/seed_clock.py default-notice 3f0c... 20 demo.finance
    python demo-video/seed_clock.py mark-overdue
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import timedelta
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))


def _refuse_unless_recording_database() -> None:
    env, target, url = os.environ.get("CRM_ENV", ""), os.environ.get("CRM_E2E_TARGET", ""), os.environ.get("CRM_DATABASE_URL", "")
    problems = []
    if env not in ("local", "test"):
        problems.append(f"CRM_ENV is {env!r} (must be local or test; never staging or prod)")
    if target.lower() != "true":
        problems.append("CRM_E2E_TARGET is not true (not a throwaway recording stack)")
    if not url.rstrip("/").endswith("/crm_video"):
        problems.append("CRM_DATABASE_URL is not the recording database crm_video")
    if problems:
        raise SystemExit("seed_clock.py: refusing to run: " + "; ".join(problems))


async def default_notice(member_id: str, days_ago: int, username: str) -> None:
    from sqlalchemy import select

    from app.audit.service import install_session_hooks
    from app.auth.models import User
    from app.core.context import RequestContext, set_context
    from app.core.db import sessionmaker
    from app.core.timeutil import today_ist
    from app.finance import service

    install_session_hooks()
    back = today_ist() - timedelta(days=days_ago)
    async with sessionmaker()() as s:
        user = (await s.execute(select(User).where(User.username == username))).scalar_one()
        set_context(RequestContext(user_id=user.id, username=user.username))
        # the only patched call: issue_default_notice reads today_ist() from its own module for the issue date
        with mock.patch.object(service, "today_ist", lambda: back):
            notice = await service.issue_default_notice(s, uuid.UUID(member_id), user)
        await s.commit()
        print(f"default notice issued_on {notice.issued_on} deadline {notice.deadline}")


async def mark_overdue() -> None:
    from app.audit.service import install_session_hooks
    from app.core.context import RequestContext, set_context
    from app.core.db import sessionmaker
    from app.finance.service import mark_overdue as job

    install_session_hooks()
    set_context(RequestContext(username="system:worker"))
    async with sessionmaker()() as s:
        n = await job(s)
        await s.commit()
    print(f"overdue instalments marked: {n}")


if __name__ == "__main__":
    _refuse_unless_recording_database()
    import app.models  # noqa: F401 - every table mapped (as in alembic/env.py), so relationships resolve
    cmd, *rest = sys.argv[1:] or [""]
    if cmd == "default-notice" and len(rest) == 3:
        asyncio.run(default_notice(rest[0], int(rest[1]), rest[2]))
    elif cmd == "mark-overdue" and not rest:
        asyncio.run(mark_overdue())
    else:
        raise SystemExit(__doc__)
