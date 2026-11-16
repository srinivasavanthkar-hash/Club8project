"""Cancellation of confirmed reservations (docs/DECISIONS.md D-31 to D-34).

* reservations.cancellation: the facts of a cancellation (notice date and where it came from, tier, nights credited
  and forfeited, ASF withdrawn, letter), kept for the letter and the record
* documents.voided_at / void_reason: a voucher of a cancelled reservation is marked, never deleted
* asf_charges.withdrawn_on / withdrawn_reason: an unpaid ASF withdrawn when its only booking is cancelled or declined
* document types CANCELLATION_LETTER (generated) and MEMBER_LETTER (a member's letter, e.g. a written request)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16
"""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation jsonb")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS voided_at timestamptz")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS void_reason varchar(300)")
    op.execute("ALTER TABLE asf_charges ADD COLUMN IF NOT EXISTS withdrawn_on date")
    op.execute("ALTER TABLE asf_charges ADD COLUMN IF NOT EXISTS withdrawn_reason varchar(300)")
    for code, name in (("CANCELLATION_LETTER", "Cancellation Letter"), ("MEMBER_LETTER", "Member letter")):
        op.get_bind().execute(
            sa.text(
                "INSERT INTO document_types (id, code, name, is_active, sort_order, is_kyc, is_sensitive, version,"
                " created_at, updated_at) SELECT gen_random_uuid(), CAST(:code AS varchar), CAST(:name AS varchar), true, 0, false, false, 1, now(),"
                " now() WHERE NOT EXISTS (SELECT 1 FROM document_types WHERE code = CAST(:code AS varchar))"
            ),
            {"code": code, "name": name},
        )


def downgrade() -> None:
    op.execute("ALTER TABLE asf_charges DROP COLUMN IF EXISTS withdrawn_reason")
    op.execute("ALTER TABLE asf_charges DROP COLUMN IF EXISTS withdrawn_on")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS void_reason")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS voided_at")
    op.execute("ALTER TABLE reservations DROP COLUMN IF EXISTS cancellation")
