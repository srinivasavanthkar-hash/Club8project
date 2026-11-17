"""Cron-style scheduler that enqueues idempotent jobs. Runs as a single replica (min=max=1) so jobs are
not enqueued twice; even if they were, the jobs are idempotent."""

import time

from app.jobs import tasks

SCAN_POLL_SECONDS = 120
RECOVERY_POLL_SECONDS = 900  # temporary passwords and admin reset requests expire within 15 minutes
SCHEDULE = [  # (IST hour, minute, actor)
    (0, 30, tasks.mark_overdue_instalments),
    (1, 0, tasks.expire_saved_nights),
    (1, 30, tasks.expire_memberships),
]


def main() -> None:
    from datetime import datetime

    from app.core.timeutil import IST

    fired: set[tuple[str, str]] = set()
    last_scan_poll = 0.0
    last_recovery_poll = 0.0
    while True:
        now = datetime.now(IST)
        if time.monotonic() - last_scan_poll >= SCAN_POLL_SECONDS:
            tasks.refresh_scan_results.send()
            last_scan_poll = time.monotonic()
        if time.monotonic() - last_recovery_poll >= RECOVERY_POLL_SECONDS:
            tasks.expire_account_recovery.send()
            last_recovery_poll = time.monotonic()
        for hour, minute, actor in SCHEDULE:
            key = (now.date().isoformat(), actor.actor_name)
            if (now.hour, now.minute) >= (hour, minute) and key not in fired:
                actor.send()
                fired.add(key)
        time.sleep(30)


if __name__ == "__main__":
    main()
