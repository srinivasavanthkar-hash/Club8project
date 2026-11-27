"""The runtime application role gets access to every table a later migration creates, automatically.

0001 granted the role the tables that existed then; 0008 had to grant its new table by hand (it was missed at first:
"permission denied" on an upgraded database). From here on, default privileges for the account that runs the
migrations grant every new table to the app role. Append-only audit tables keep their 0001 restrictions (and their
triggers); a future append-only table must revoke UPDATE/DELETE in its own migration. Also re-asserts the grants on
the existing tables. tests/integration/test_db_grants.py checks it, including a table created after this migration.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-27
"""

import os

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

APPEND_ONLY = ("activity_log", "record_versions", "entitlement_ledger")


def _app_role() -> str | None:
    role = os.environ.get("CRM_APP_DB_ROLE", "crm_app")
    exists = op.get_bind().execute(sa.text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first()
    return '"' + role.replace('"', "") + '"' if exists else None


def upgrade() -> None:
    role = _app_role()
    if role is None:  # no separate runtime role on this database (tests, the e2e runner)
        return
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}")
    for t in APPEND_ONLY:
        op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {t} FROM {role}")
    # tables and sequences created later by this account (the one that runs the migrations)
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role}")
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role}")


def downgrade() -> None:
    role = _app_role()
    if role is None:
        return
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {role}")
    # role: our own setting, quoted as an identifier (as in 0001); not user input
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM {role}")  # noqa: S608
