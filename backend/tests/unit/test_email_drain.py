"""dispatch.drain() must return even when a finished task was never removed from the task set.

Regression for the CI hang of 18-11-2026: under coverage tracing a finished email task's done-callback
was never run, the set never emptied and drain() looped forever. The old loop could not even be cancelled
(awaiting gather() on finished tasks swallows the cancellation), so each scenario runs on its own event loop in a
daemon thread with a deadline: a regression fails after a few seconds instead of hanging the suite.
"""

import asyncio
import threading
from collections.abc import Callable, Coroutine
from typing import Any

from app.email import dispatch

DEADLINE_SECONDS = 5


def _finishes_in_time(scenario: Callable[[], Coroutine[Any, Any, None]]) -> bool:
    errors: list[BaseException] = []

    def run() -> None:
        try:
            asyncio.run(scenario())
        except BaseException as e:
            errors.append(e)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(DEADLINE_SECONDS)
    if errors:
        raise errors[0]
    return not t.is_alive()


async def _noop() -> bool:
    return True


def test_drain_returns_when_a_finished_task_was_never_removed() -> None:
    state: dict[str, Any] = {}

    async def scenario() -> None:
        stale = asyncio.get_running_loop().create_task(_noop())
        await stale  # finished, but nothing removed it: the skipped clean-up step
        dispatch._TASKS.add(stale)
        state["stale"] = stale
        await dispatch.drain()

    try:
        assert _finishes_in_time(scenario), f"drain() still looping after {DEADLINE_SECONDS} s"
        assert state["stale"] not in dispatch._TASKS
    finally:
        if "stale" in state:
            dispatch._TASKS.discard(state["stale"])


def test_drain_waits_for_unfinished_tasks_and_they_remove_themselves(monkeypatch) -> None:
    sent: list[str] = []
    tasks: list[asyncio.Task[bool]] = []

    async def fake_deliver(job: dict, attempts: int = 3, raise_on_failure: bool = False) -> bool:
        await asyncio.sleep(0.05)
        sent.append(job["to"])
        return True

    monkeypatch.setattr(dispatch, "deliver", fake_deliver)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        tasks.extend(loop.create_task(dispatch._deliver_tracked({"to": f"user{i}@example.test"})) for i in range(3))
        dispatch._TASKS.update(tasks)
        await dispatch.drain()

    try:
        assert _finishes_in_time(scenario), f"drain() still looping after {DEADLINE_SECONDS} s"
        assert sorted(sent) == ["user0@example.test", "user1@example.test", "user2@example.test"]
        assert not any(t in dispatch._TASKS for t in tasks)
    finally:
        dispatch._TASKS.difference_update(tasks)
