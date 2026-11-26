"""Setting ui.week_start (first day of the week in date pickers), so it shows in Admin on existing databases.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-26
"""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "INSERT INTO system_settings (id, key, value, description, version) "
            "VALUES (gen_random_uuid(), 'ui.week_start', '\"MONDAY\"'::jsonb, "
            "'First day of the week in date pickers: Monday or Sunday.', 1) ON CONFLICT (key) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM system_settings WHERE key = 'ui.week_start'"))
