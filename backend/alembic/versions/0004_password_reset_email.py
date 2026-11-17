"""Self-service password reset by email (docs/PASSWORD_PROMPT.md, Phase 2).

* password_reset_tokens: SHA-256 hashes of single-use reset tokens (never the token itself)
* admin_reset_requests.method: TEMP_PASSWORD (option B) or EMAIL_LINK (option A)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-13
"""

import os

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash varchar(64) NOT NULL UNIQUE,
            purpose varchar(20) NOT NULL,
            created_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL,
            used_at timestamptz,
            invalidated_at timestamptz,
            request_ip varchar(45),
            user_agent varchar(400)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)")
    op.execute(
        "ALTER TABLE admin_reset_requests ADD COLUMN IF NOT EXISTS method varchar(20) NOT NULL DEFAULT 'TEMP_PASSWORD'"
    )
    bind = op.get_bind()
    app_role = os.environ.get("CRM_APP_DB_ROLE", "crm_app")
    if bind.execute(sa.text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": app_role}).first():
        r = '"' + app_role.replace('"', "") + '"'
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO {r}")


def downgrade() -> None:
    op.execute("ALTER TABLE admin_reset_requests DROP COLUMN IF EXISTS method")
    op.execute("DROP TABLE IF EXISTS password_reset_tokens")
