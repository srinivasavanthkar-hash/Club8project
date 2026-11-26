"""Membership number series (Phase 2): prefixes by company and, optionally, sales venue / property.

Each company's single prefix and counter become one company-wide series (same prefix, same next number), and every
existing member is linked to it. No membership number changes. Members also get an optional home property.

Idempotent like the other migrations: a fresh database already has the new tables and columns from the baseline
(0001 creates them from the current models), and no companies.membership_prefix to copy from.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-26
"""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return (
        op.get_bind()
        .execute(
            sa.text("SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"),
            {"t": table, "c": column},
        )
        .first()
        is not None
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS membership_number_series (
            id uuid PRIMARY KEY,
            company_id uuid NOT NULL REFERENCES companies (id),
            venue_id uuid REFERENCES venues (id),
            property_id uuid REFERENCES properties (id),
            prefix varchar(10) NOT NULL UNIQUE,
            next_number integer NOT NULL DEFAULT 1,
            active_from date NOT NULL,
            active_to date,
            to_be_confirmed boolean NOT NULL DEFAULT false,
            notes text NOT NULL DEFAULT '',
            version integer NOT NULL DEFAULT 1,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            created_by uuid REFERENCES users (id),
            updated_by uuid REFERENCES users (id),
            CONSTRAINT ck_series_prefix CHECK (prefix ~ '^[A-Z0-9]{2,10}$'),
            CONSTRAINT ck_series_next_number CHECK (next_number >= 1),
            CONSTRAINT ck_series_dates CHECK (active_to IS NULL OR active_to >= active_from)
        )
        """
    )
    op.execute("ALTER TABLE members ADD COLUMN IF NOT EXISTS number_series_id uuid")
    op.execute("ALTER TABLE members ADD COLUMN IF NOT EXISTS home_property_id uuid REFERENCES properties (id)")
    if _has_column("companies", "membership_prefix"):
        # One company-wide series per company, from its prefix and counter; active from its first purchase.
        op.execute(
            """
            INSERT INTO membership_number_series (id, company_id, prefix, next_number, active_from, notes)
            SELECT gen_random_uuid(), c.id, upper(c.membership_prefix), c.next_membership_seq,
                   COALESCE((SELECT min(m.purchase_date) FROM members m WHERE m.company_id = c.id), CURRENT_DATE),
                   'The company''s prefix before number series (migration 0008).'
            FROM companies c
            WHERE NOT EXISTS (SELECT 1 FROM membership_number_series s WHERE s.company_id = c.id)
            """
        )
        op.execute(
            "UPDATE members m SET number_series_id = s.id FROM membership_number_series s "
            "WHERE m.number_series_id IS NULL AND s.company_id = m.company_id "
            "AND s.venue_id IS NULL AND s.property_id IS NULL"
        )
        op.execute("ALTER TABLE companies DROP COLUMN membership_prefix")
        op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS next_membership_seq")
    op.execute("ALTER TABLE members ALTER COLUMN number_series_id SET NOT NULL")
    op.execute(
        """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conrelid = 'members'::regclass AND contype = 'f'
              AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                  WHERE attrelid = 'members'::regclass AND attname = 'number_series_id')]
          ) THEN
            ALTER TABLE members ADD CONSTRAINT fk_members_number_series
              FOREIGN KEY (number_series_id) REFERENCES membership_number_series (id);
          END IF;
        END $$
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_members_number_series_id ON members (number_series_id)")


def downgrade() -> None:
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS membership_prefix varchar(20)")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_membership_seq integer NOT NULL DEFAULT 1")
    # The company-wide series gives the prefix back; the counter is the highest of the company's series, so no number
    # can be issued twice. Members of other series keep their numbers.
    op.execute(
        """
        UPDATE companies c SET
          membership_prefix = COALESCE(
            (SELECT s.prefix FROM membership_number_series s
             WHERE s.company_id = c.id AND s.venue_id IS NULL AND s.property_id IS NULL
             ORDER BY s.active_from LIMIT 1),
            (SELECT s.prefix FROM membership_number_series s WHERE s.company_id = c.id ORDER BY s.active_from LIMIT 1),
            c.code),
          next_membership_seq = COALESCE(
            (SELECT max(s.next_number) FROM membership_number_series s WHERE s.company_id = c.id), 1)
        """
    )
    op.execute("ALTER TABLE companies ALTER COLUMN membership_prefix SET NOT NULL")
    op.execute("ALTER TABLE members DROP COLUMN IF EXISTS home_property_id")
    op.execute("ALTER TABLE members DROP COLUMN IF EXISTS number_series_id")  # its index and foreign key go with it
    op.execute("DROP TABLE IF EXISTS membership_number_series")
