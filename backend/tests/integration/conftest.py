import contextlib
import os
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

pytestmark = pytest.mark.integration


def _load_local_db() -> Any:
    """scripts/local_db.py, which owns the embedded-server folders (crm_local's and the scratch one)."""
    import importlib.util

    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "local_db.py")
    spec = importlib.util.spec_from_file_location("crm_local_db", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _admin_url() -> Iterator[str]:
    url = os.environ.get("CRM_TEST_DATABASE_URL")
    if url:
        yield url
        return
    try:
        from testcontainers.postgres import PostgresContainer

        with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
            yield pg.get_connection_url()
            return
    except Exception:
        pass
    try:
        import pgserver
    except ImportError:
        pytest.skip("No PostgreSQL available (set CRM_TEST_DATABASE_URL, run Docker, or pip install pgserver)")
    # the scratch embedded server, never crm_local's (scripts/local_db.py owns both folders)
    local_db = _load_local_db()
    d = local_db.scratch_dir()
    local_db.refuse_crm_local_dir(d, "integration tests")
    srv = pgserver.get_server(d, cleanup_mode=None)
    yield srv.get_uri().replace("postgresql://", "postgresql+asyncpg://")


@pytest.fixture(scope="session")
def admin_url() -> Iterator[str]:
    yield from _admin_url()


@pytest_asyncio.fixture(scope="session")
async def engine(admin_url: str) -> AsyncIterator[AsyncEngine]:
    dbname = f"crm_test_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'CREATE DATABASE "{dbname}"'))
    base, _, _ = admin_url.rpartition("/")
    url = f"{base}/{dbname}"
    eng = create_async_engine(url, pool_size=5)

    from alembic.config import Config

    from alembic import command

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))

    def _upgrade(sync_conn: Any) -> None:
        cfg.attributes["connection"] = sync_conn
        command.upgrade(cfg, "head")

    async with eng.begin() as conn:
        await conn.run_sync(_upgrade)

    from app.core.db import set_engine

    set_engine(eng)
    from app.audit.service import install_session_hooks
    from app.core.db import sessionmaker
    from app.seed_demo import seed_demo

    install_session_hooks()
    async with sessionmaker()() as s:
        await seed_demo(s)
        await s.commit()
    yield eng
    await eng.dispose()
    async with admin.connect() as c:
        with contextlib.suppress(Exception):
            await c.execute(text(f'DROP DATABASE "{dbname}" WITH (FORCE)'))
    await admin.dispose()


class Api:
    """Thin client wrapper: logs in as a demo user and sends the CSRF header automatically."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.c = client

    async def login(self, username: str, password: str | None = None, totp_secret: str | None = None) -> dict[str, Any]:
        """Signs in; completes the 2FA step for demo users that have it (demo.admin) or with `totp_secret`."""
        import pyotp

        from app.seed_demo import DEMO_PASSWORD, DEMO_TOTP_USERS

        self.c.cookies.clear()
        body: dict[str, Any] = {"username": username, "password": password or DEMO_PASSWORD}
        r = await self.c.post("/api/v1/auth/login", json=body)
        secret = totp_secret or DEMO_TOTP_USERS.get(username)
        if r.status_code == 401 and r.json().get("code") == "TotpRequired" and secret:
            r = await self.c.post("/api/v1/auth/login", json={**body, "totp_code": pyotp.TOTP(secret).now()})
        assert r.status_code == 200, r.text
        return r.json()

    def _h(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"X-CSRF-Token": self.c.cookies.get("crm_csrf") or ""}
        h.update(extra or {})
        return h

    async def get(self, url: str, **kw: Any) -> httpx.Response:
        return await self.c.get(url, **kw)

    async def post(
        self, url: str, json: Any = None, headers: dict[str, str] | None = None, **kw: Any
    ) -> httpx.Response:
        return await self.c.post(url, json=json, headers=self._h(headers), **kw)

    async def patch(self, url: str, json: Any = None, headers: dict[str, str] | None = None) -> httpx.Response:
        return await self.c.patch(url, json=json, headers=self._h(headers))

    async def put(self, url: str, json: Any = None) -> httpx.Response:
        return await self.c.put(url, json=json, headers=self._h())


@pytest_asyncio.fixture
async def api(engine: AsyncEngine) -> AsyncIterator[Api]:
    from app.main import app

    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield Api(client)
