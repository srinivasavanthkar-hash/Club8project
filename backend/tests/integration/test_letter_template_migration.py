"""Migration 0006 swaps letter templates still identical to an earlier default; admin-edited ones are left alone."""

import importlib.util
import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.correspondence import letters

EDITED = "<h1>Notice of Default</h1><p>Our own wording, edited by an admin: {{ notice.amount_overdue|inr }}</p>"


def _migration() -> Any:
    path = os.path.join(os.path.dirname(__file__), "..", "..", "alembic", "versions", "0006_letter_labels.py")
    spec = importlib.util.spec_from_file_location("m0006", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(sync_conn: Any) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    with Operations.context(MigrationContext.configure(sync_conn)):
        _migration().upgrade()


async def test_0006_updates_unedited_templates_only(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        tx = await conn.begin()
        try:
            set_body = text("UPDATE letter_templates SET body_html = :b WHERE code = :c")
            await conn.execute(set_body, {"b": letters._V3_TEMPLATES["RECEIPT"], "c": "RECEIPT"})
            await conn.execute(set_body, {"b": EDITED, "c": "DEFAULT_NOTICE"})
            await conn.run_sync(_run_upgrade)
            rows = dict(
                (
                    await conn.execute(
                        text("SELECT code, body_html FROM letter_templates WHERE code IN ('RECEIPT', 'DEFAULT_NOTICE')")
                    )
                ).all()
            )
            assert rows["RECEIPT"] == letters.DEFAULT_TEMPLATES["RECEIPT"]
            assert "{{ payment_type }}" in rows["RECEIPT"] and "payment_type_code" not in rows["RECEIPT"]
            assert rows["DEFAULT_NOTICE"] == EDITED
        finally:
            await tx.rollback()
