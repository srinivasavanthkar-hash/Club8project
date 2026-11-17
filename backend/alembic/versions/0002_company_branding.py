"""Company branding for generated documents: logo, brand colours, and a details-pending flag.

Also brings the default letter templates (only rows still identical to the previous defaults) to the version whose
brand header (logo, legal name, address) is added by the renderer, so headers are not printed twice.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# Known brands (codes from the demo / production master data). Other companies keep empty values until an admin
# sets them in Master data.
BRANDS = {
    "CLUB8": ("club8/club8-logo.png", "#393186", "#EF7F1B"),
    "K8": ("k8/k8-logo.png", "#172040", "#BC9C23"),
}


def upgrade() -> None:
    # IF NOT EXISTS: revision 0001 builds tables from the live models, so fresh databases already have the columns.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_path varchar(200) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_colour varchar(7) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS accent_colour varchar(7) NOT NULL DEFAULT ''")
    op.execute(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS details_pending_confirmation boolean NOT NULL DEFAULT false"
    )
    bind = op.get_bind()
    for code, (logo, primary, accent) in BRANDS.items():
        bind.execute(
            sa.text(
                "UPDATE companies SET logo_path = :logo, primary_colour = :p, accent_colour = :a "
                "WHERE code = :code AND logo_path = ''"
            ),
            {"logo": logo, "p": primary, "a": accent, "code": code},
        )
    # K8's legal entity is unconfirmed (docs/OPEN_QUESTIONS.md): never print the Club8 LLP on K8 documents.
    bind.execute(
        sa.text(
            "UPDATE companies SET legal_name = 'Klub Eight Asia Ventures', details_pending_confirmation = true "
            "WHERE code = 'K8' AND legal_name = 'Multiple Sales and Marketing LLP'"
        )
    )
    from app.correspondence.letters import DEFAULT_TEMPLATES, PREVIOUS_DEFAULT_TEMPLATES

    for code, olds in PREVIOUS_DEFAULT_TEMPLATES.items():
        for old in olds:
            bind.execute(
                sa.text("UPDATE letter_templates SET body_html = :new WHERE code = :code AND body_html = :old"),
                {"new": DEFAULT_TEMPLATES[code], "old": old, "code": code},
            )


def downgrade() -> None:
    for col in ("logo_path", "primary_colour", "accent_colour", "details_pending_confirmation"):
        op.execute(f"ALTER TABLE companies DROP COLUMN IF EXISTS {col}")
