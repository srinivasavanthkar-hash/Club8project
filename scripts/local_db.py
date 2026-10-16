"""Developer helper for machines without Docker: start an embedded PostgreSQL (pgserver), create a fresh
database, run Alembic migrations and seed DEMO data. Prints the asyncpg URL to use as CRM_DATABASE_URL.

    python scripts/local_db.py [--name crm_e2e]
"""

import argparse
import asyncio
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))


async def main(name: str) -> str:
    import pgserver
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    srv = pgserver.get_server(os.path.join(tempfile.gettempdir(), "club8-crm-pgserver"), cleanup_mode=None)
    admin_url = srv.get_uri().replace("postgresql://", "postgresql+asyncpg://")
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await c.execute(text(f'CREATE DATABASE "{name}"'))
    await admin.dispose()
    url = admin_url.rsplit("/", 1)[0] + f"/{name}"
    os.environ["CRM_DATABASE_URL"] = url

    from alembic import command
    from alembic.config import Config

    eng = create_async_engine(url)
    cfg = Config(os.path.join(ROOT, "backend", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(ROOT, "backend", "alembic"))

    def upgrade(conn):  # type: ignore[no-untyped-def]
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")

    async with eng.begin() as conn:
        await conn.run_sync(upgrade)

    from app.audit.service import install_session_hooks
    from app.core.db import sessionmaker, set_engine
    from app.seed_demo import seed_demo

    set_engine(eng)
    install_session_hooks()
    async with sessionmaker()() as s:
        await seed_demo(s)
        await s.commit()
    await eng.dispose()
    return url


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="crm_local")
    print(asyncio.run(main(p.parse_args().name)))
