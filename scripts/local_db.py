"""Developer helper: create a fresh database, run Alembic migrations and seed DEMO data. Prints the asyncpg URL to
use as CRM_DATABASE_URL.

Embedded PostgreSQL (pgserver), for machines without Docker, in two separate data folders:
  * .local/club8-crm-pgserver          crm_local only: the developers' working demo database. Only
                                        `local_db.py --name crm_local` (run deliberately) starts this server.
  * .local/club8-crm-pgserver-scratch  everything else (crm_video, crm_e2e, test runs): a server that can be
                                        restarted, recovered or deleted without affecting crm_local.
The folders are fixed (not the temp folder, which differs between shells). Other scripts that start pgserver call
`scratch_dir()` / `refuse_crm_local_dir()` from here, so they can never open crm_local's folder.

With --admin-url it uses that server instead (e.g. a throwaway Docker container; demo-video/src/stack.ts).

    python scripts/local_db.py --name crm_local                 # drops and re-creates crm_local (DEMO data)
    python scripts/local_db.py --name crm_local --no-reset      # starts its server and checks it; changes nothing
    python scripts/local_db.py --name crm_e2e                   # on the scratch server
    python scripts/local_db.py --name crm_video --admin-url postgresql+asyncpg://user:pw@127.0.0.1:5433/postgres
"""

import argparse
import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

LOCAL = os.path.join(ROOT, ".local")
CRM_LOCAL = "crm_local"
CRM_LOCAL_DIR = os.path.join(LOCAL, "club8-crm-pgserver")
SCRATCH_DIR = os.path.join(LOCAL, "club8-crm-pgserver-scratch")


def _same_or_inside(path: str, folder: str) -> bool:
    p, f = (os.path.normcase(os.path.realpath(x)) for x in (path, folder))
    return p == f or p.startswith(f + os.sep)


def refuse_crm_local_dir(path: str, who: str) -> None:
    """Stops a script that is about to use crm_local's data folder (anything but `local_db.py --name crm_local`)."""
    if _same_or_inside(path, CRM_LOCAL_DIR):
        raise SystemExit(
            f"{who}: refusing to use {CRM_LOCAL_DIR}: that folder holds crm_local, the developers' working database. "
            f"Only `python scripts/local_db.py --name crm_local` starts it. Use {SCRATCH_DIR} (scratch_dir())."
        )


def scratch_dir() -> str:
    """The throwaway embedded server's folder, for every database except crm_local."""
    os.makedirs(SCRATCH_DIR, exist_ok=True)
    return SCRATCH_DIR


def _embedded_admin_url(name: str) -> str:
    import pgserver

    folder = CRM_LOCAL_DIR if name == CRM_LOCAL else scratch_dir()
    if name != CRM_LOCAL:
        refuse_crm_local_dir(folder, f"local_db.py --name {name}")
    srv = pgserver.get_server(folder, cleanup_mode=None)
    return srv.get_uri().replace("postgresql://", "postgresql+asyncpg://")


async def check(name: str) -> str:
    """--no-reset: start the server, confirm the database answers, report its migration revision. Changes nothing."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    url = _embedded_admin_url(name).rsplit("/", 1)[0] + f"/{name}"
    eng = create_async_engine(url)
    try:
        async with eng.connect() as c:
            rev = (await c.execute(text("SELECT version_num FROM alembic_version"))).scalar()
            members = (await c.execute(text("SELECT count(*) FROM members"))).scalar()
    finally:
        await eng.dispose()
    print(f"{name}: up, migration revision {rev}, {members} members", file=sys.stderr)
    return url


async def main(name: str, admin_url: str | None = None) -> str:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    if admin_url is None:
        admin_url = _embedded_admin_url(name)
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
    # required: running the script without a name used to drop and re-create crm_local
    p.add_argument("--name", required=True, help="database to (re)create, e.g. crm_local, crm_e2e, crm_video")
    p.add_argument("--admin-url", help="asyncpg URL of an existing server's admin database (default: embedded)")
    p.add_argument("--no-reset", action="store_true", help="only start the embedded server and check the database")
    a = p.parse_args()
    if a.no_reset:
        if a.admin_url:
            p.error("--no-reset is for the embedded server")
        print(asyncio.run(check(a.name)))
    else:
        print(asyncio.run(main(a.name, a.admin_url)))
