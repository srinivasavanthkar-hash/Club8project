"""The API's database role can use every table, including tables added by future migrations.

The API runs as a restricted role (crm_app); the migrations run as the owner. Tests and the e2e runner connect as the
owner, so a missing grant only shows as "permission denied" in Docker and Azure (it happened with 0008). This test
runs as its own CI step (ci.yml "Database grants for the app role") on every push.

It walks the real upgrade path, not just a fresh database (where the baseline creates every table and grants them
all): it goes back to 0001 and upgrades again, then creates a table the way a future migration would and checks the
role can use it without anyone remembering a GRANT (0009: default privileges). Audit tables stay append-only.
"""

import os
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROLE = "crm_app"
APPEND_ONLY = ("activity_log", "record_versions", "entitlement_ledger")

PRIVILEGES = f"""
    SELECT c.relname,
           has_table_privilege('{ROLE}', c.oid, 'SELECT, INSERT'),
           has_table_privilege('{ROLE}', c.oid, 'UPDATE'),
           has_table_privilege('{ROLE}', c.oid, 'DELETE')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'alembic_version'
"""


async def test_the_app_role_can_use_every_table_now_and_after_future_migrations(admin_url: str) -> None:
    from alembic.config import Config

    from alembic import command

    dbname = f"crm_grants_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'CREATE DATABASE "{dbname}"'))
        if not (await c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'"))).first():
            await c.execute(text(f"CREATE ROLE {ROLE} NOLOGIN"))
    eng = create_async_engine(f"{admin_url.rpartition('/')[0]}/{dbname}")
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))

    def upgrade_path(sync_conn: Any) -> None:
        # every migration after the baseline runs as it would on an existing database
        cfg.attributes["connection"] = sync_conn
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "0001")
        command.upgrade(cfg, "head")

    try:
        async with eng.begin() as c:
            await c.run_sync(upgrade_path)
            # a table created later by the migration account, as a future migration would (no GRANT written)
            await c.execute(text("CREATE TABLE zz_future_migration_table (id uuid PRIMARY KEY, note text)"))
            rows = (await c.execute(text(PRIVILEGES))).all()
        privileges = {name: (use, upd, dele) for name, use, upd, dele in rows}
        assert "membership_number_series" in privileges and "zz_future_migration_table" in privileges

        missing = sorted(name for name, (use, _, _) in privileges.items() if not use)
        assert missing == [], f"the app role cannot read/insert: {missing}"
        not_editable = sorted(
            name for name, (_, upd, dele) in privileges.items() if name not in APPEND_ONLY and not (upd and dele)
        )
        assert not_editable == [], f"the app role cannot update/delete: {not_editable}"
        still_editable = [t for t in APPEND_ONLY if privileges[t][1] or privileges[t][2]]
        assert still_editable == [], f"append-only tables must not be updatable or deletable: {still_editable}"
    finally:
        await eng.dispose()
        async with admin.connect() as c:
            await c.execute(text(f'DROP DATABASE "{dbname}" WITH (FORCE)'))
        await admin.dispose()
