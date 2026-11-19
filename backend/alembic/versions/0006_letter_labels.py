"""Letter templates: payment-type names instead of codes, amounts in their own currency (Phase 1 fixes).

Rows still identical to an earlier default are swapped for the current default; templates an admin has edited are
left alone (same rule as 0002).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.correspondence.letters import DEFAULT_TEMPLATES, PREVIOUS_DEFAULT_TEMPLATES

    bind = op.get_bind()
    for code, olds in PREVIOUS_DEFAULT_TEMPLATES.items():
        for old in olds:
            bind.execute(
                sa.text("UPDATE letter_templates SET body_html = :new WHERE code = :code AND body_html = :old"),
                {"new": DEFAULT_TEMPLATES[code], "old": old, "code": code},
            )


def downgrade() -> None:
    from app.correspondence.letters import _V3_TEMPLATES, DEFAULT_TEMPLATES

    bind = op.get_bind()
    for code, body in _V3_TEMPLATES.items():
        if body != DEFAULT_TEMPLATES[code]:
            bind.execute(
                sa.text("UPDATE letter_templates SET body_html = :old WHERE code = :code AND body_html = :new"),
                {"new": DEFAULT_TEMPLATES[code], "old": body, "code": code},
            )
