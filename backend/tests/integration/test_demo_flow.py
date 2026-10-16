"""Section 14 demo as an automated acceptance test (API level). The Playwright e2e test drives the same
flow through the UI."""

import pytest

from app.demo_scenario import run_demo

pytestmark = pytest.mark.integration


async def test_initial_delivery_demo(api):
    report = await run_demo(api, seed=14)
    assert report["confirmation_blocked_until_asf_paid"]
    assert report["remaining_after"] == "3.0"
    assert report["membership_number"].startswith("MSMC8-")
