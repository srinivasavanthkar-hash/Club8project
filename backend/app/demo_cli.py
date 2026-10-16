"""Run the Section 14 demo scenario against a running stack (used by scripts/seed-demo.sh).

python -m app.demo_cli --base-url http://localhost:3000
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

import httpx

from app.demo_scenario import run_demo
from app.seed_demo import DEMO_PASSWORD


class HttpClient:
    def __init__(self, base_url: str) -> None:
        self.c = httpx.AsyncClient(base_url=base_url, timeout=60)

    async def login(self, username: str, password: str | None = None) -> dict[str, Any]:
        self.c.cookies.clear()
        r = await self.c.post("/api/v1/auth/login", json={"username": username, "password": password or DEMO_PASSWORD})
        r.raise_for_status()
        data: dict[str, Any] = r.json()
        return data

    def _h(self, extra: dict[str, str] | None) -> dict[str, str]:
        return {"X-CSRF-Token": self.c.cookies.get("crm_csrf") or "", **(extra or {})}

    async def get(self, url: str, **kw: Any) -> httpx.Response:
        return await self.c.get(url, **kw)

    async def post(
        self, url: str, json: Any = None, headers: dict[str, str] | None = None, **kw: Any
    ) -> httpx.Response:
        return await self.c.post(url, json=json, headers=self._h(headers), **kw)

    async def patch(self, url: str, json: Any = None, headers: dict[str, str] | None = None) -> httpx.Response:
        return await self.c.patch(url, json=json, headers=self._h(headers))


async def main(base_url: str) -> None:
    client = HttpClient(base_url)
    report = await run_demo(client)
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost:3000")
    asyncio.run(main(p.parse_args().base_url))
