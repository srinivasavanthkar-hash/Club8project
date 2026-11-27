"""Migration 0008 keeps every membership number: each company's prefix and counter become one company-wide series,
every member is linked to it, and the downgrade gives the prefix and counter back. Runs on its own throwaway database
(fictitious rows), so the shared test database is untouched."""

import os
import uuid
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

FILL = {"uuid": "gen_random_uuid()", "integer": "1", "smallint": "1", "numeric": "0", "boolean": "false",
        "date": "DATE '2024-01-01'", "jsonb": "'{}'::jsonb", "timestamp with time zone": "now()"}  # fmt: skip


async def _insert(c: AsyncConnection, table: str, values: dict[str, Any]) -> uuid.UUID:
    """Inserts a row giving every NOT NULL column without a default a plain value, plus `values`."""
    cols = (
        await c.execute(
            text(
                "SELECT column_name, data_type, character_maximum_length FROM information_schema.columns "
                "WHERE table_name = :t "
                "AND is_nullable = 'NO' AND column_default IS NULL"
            ),
            {"t": table},
        )
    ).all()
    names, exprs, params = [], [], {}
    for name, dtype, max_len in cols:
        if name in values:
            continue
        names.append(name)
        text_value = f"left(md5(random()::text), {min(max_len or 12, 12)})"  # unique enough, fits the column
        exprs.append(FILL.get(dtype, text_value))
    for i, (k, v) in enumerate(values.items()):
        names.append(k)
        exprs.append(f":p{i}")
        params[f"p{i}"] = v
    sql = f"INSERT INTO {table} ({', '.join(names)}) VALUES ({', '.join(exprs)}) RETURNING id"
    return (await c.execute(text(sql), params)).scalar_one()


async def test_numbers_survive_the_upgrade_and_the_downgrade(admin_url: str) -> None:
    from alembic.config import Config

    from alembic import command

    dbname = f"crm_mig_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'CREATE DATABASE "{dbname}"'))
    eng = create_async_engine(f"{admin_url.rpartition('/')[0]}/{dbname}")
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))

    def migrate(target: str, down: bool = False) -> Any:
        def run(sync_conn: Any) -> None:
            cfg.attributes["connection"] = sync_conn
            (command.downgrade if down else command.upgrade)(cfg, target)

        return run

    try:
        async with eng.begin() as c:
            # a fresh database is built at head from the current models; the downgrade gives the real pre-0008 shape
            await c.run_sync(migrate("head"))
            await c.run_sync(migrate("0007", down=True))
            club8 = await _insert(
                c, "companies", {"code": "MIG-C8", "membership_prefix": "MSMC8", "next_membership_seq": 9050}
            )
            k8 = await _insert(
                c, "companies", {"code": "MIG-K8", "membership_prefix": "msmk8", "next_membership_seq": 5001}
            )
            refs = {
                t: await _insert(c, t, {"code": f"MIG-{t[:6]}"}) for t in ("resort_categories", "seasons", "unit_types")
            }
            before = {}
            for company, number, seq, bought in (
                (club8, "MSMC8-9030", "9030", date(2021, 3, 4)),
                (club8, "MSMC8-9031", "9031", date(2022, 5, 6)),
                (k8, "MSMK8-5000", "5000", date(2023, 7, 8)),
            ):
                mid = await _insert(c, "members", {
                    "company_id": company, "balance_mode": "NONE", "status": "ACTIVE", "currency": "INR",
                    "nights_per_year": 7,
                    "membership_number": number, "membership_seq": seq, "purchase_date": bought,
                    "resort_category_id": refs["resort_categories"], "season_id": refs["seasons"],
                    "unit_type_id": refs["unit_types"],
                })  # fmt: skip
                before[mid] = number

        async with eng.begin() as c:
            await c.run_sync(migrate("0008"))
            rows = (
                await c.execute(
                    text(
                        "SELECT m.id, m.membership_number, s.prefix, s.next_number, s.active_from, s.venue_id, "
                        "s.property_id, m.home_property_id FROM members m "
                        "JOIN membership_number_series s ON s.id = m.number_series_id"
                    )
                )
            ).all()
            assert {r[0]: r[1] for r in rows} == before  # no number changed
            series = {r[2]: (r[3], r[4], r[5], r[6]) for r in rows}
            assert series == {
                "MSMC8": (9050, date(2021, 3, 4), None, None),  # same counter; active from the first purchase
                "MSMK8": (5001, date(2023, 7, 8), None, None),  # stored in capitals
            }
            assert all(r[7] is None for r in rows)
            cols = (
                (
                    await c.execute(
                        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'companies'")
                    )
                )
                .scalars()
                .all()
            )
            assert "membership_prefix" not in cols and "next_membership_seq" not in cols

        async with eng.begin() as c:
            await c.run_sync(migrate("0007", down=True))
            back = dict((await c.execute(text("SELECT id, membership_number FROM members"))).all())
            assert back == before
            companies = dict(
                (
                    await c.execute(text("SELECT code, membership_prefix || ':' || next_membership_seq FROM companies"))
                ).all()
            )
            assert companies["MIG-C8"] == "MSMC8:9050" and companies["MIG-K8"] == "MSMK8:5001"
    finally:
        await eng.dispose()
        async with admin.connect() as c:
            await c.execute(text(f'DROP DATABASE "{dbname}" WITH (FORCE)'))
        await admin.dispose()


async def test_the_app_role_can_use_every_table(admin_url: str) -> None:
    """The API runs as a restricted role (crm_app; the migrations run as the owner). Every table a migration adds
    must be granted to it, or the API fails with "permission denied" in Docker and Azure while tests run as the owner.
    Append-only audit tables stay insert-only."""
    from alembic.config import Config

    from alembic import command

    dbname = f"crm_grants_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'CREATE DATABASE "{dbname}"'))
        if not (await c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'crm_app'"))).first():
            await c.execute(text("CREATE ROLE crm_app NOLOGIN"))
    eng = create_async_engine(f"{admin_url.rpartition('/')[0]}/{dbname}")
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))

    def upgrade(sync_conn: Any) -> None:
        # A fresh database gets every table from the baseline (and 0001's grants on all of them); the real case is an
        # existing database where a later migration creates the table: go back before 0008 and upgrade again.
        cfg.attributes["connection"] = sync_conn
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "0007")
        command.upgrade(cfg, "head")

    try:
        async with eng.begin() as c:
            await c.run_sync(upgrade)
            rows = (
                await c.execute(
                    text(
                        "SELECT tablename, has_table_privilege('crm_app', 'public.' || tablename, 'SELECT, INSERT'), "
                        "has_table_privilege('crm_app', 'public.' || tablename, 'UPDATE') "
                        "FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
                    )
                )
            ).all()
        missing = sorted(t for t, can_use, _ in rows if not can_use)
        assert missing == [], f"no grant for the app role on: {missing}"
        updatable = {t: can_update for t, _, can_update in rows}
        assert updatable["membership_number_series"] and updatable["members"]
        assert not any(updatable[t] for t in ("activity_log", "record_versions", "entitlement_ledger"))
    finally:
        await eng.dispose()
        async with admin.connect() as c:
            await c.execute(text(f'DROP DATABASE "{dbname}" WITH (FORCE)'))
        await admin.dispose()
