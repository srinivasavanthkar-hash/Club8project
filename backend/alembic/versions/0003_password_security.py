"""Password and account-access security (docs/PASSWORD_PROMPT.md, Phase 1).

* users: token_version (session revocation), password_changed_at, temporary-password expiry, must_enroll_totp
* password_history: bcrypt hashes of previous passwords (reuse check), backfilled with each current hash
* admin_reset_requests: second-admin approval for resetting an ADMIN's password
* permissions user.reset_password and user.reset_2fa, granted to ADMIN only

Existing users keep their current passwords.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-13
"""

import os

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

PERMISSIONS = {
    "user.reset_password": "Reset another user's password (system-generated temporary password)",
    "user.reset_2fa": "Reset another user's two-step verification",
}


def upgrade() -> None:
    # IF NOT EXISTS: revision 0001 builds tables from the live models, so fresh databases already have these.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_enroll_totp boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at timestamptz")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expired_at timestamptz")
    op.execute("UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS password_history (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            password_hash varchar(100) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_password_history_user_id ON password_history (user_id)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_reset_requests (
            id uuid PRIMARY KEY,
            created_at timestamptz NOT NULL DEFAULT now(),
            target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            requested_by uuid NOT NULL REFERENCES users(id),
            reason varchar(500) NOT NULL,
            expires_at timestamptz NOT NULL,
            status varchar(20) NOT NULL,
            decided_by uuid REFERENCES users(id),
            decision_reason varchar(500),
            decided_at timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_admin_reset_requests_target_user_id ON admin_reset_requests (target_user_id)"
    )
    bind = op.get_bind()
    # The runtime role (see 0001) needs the same rights on the new tables as on every other non-append-only table.
    app_role = os.environ.get("CRM_APP_DB_ROLE", "crm_app")
    if bind.execute(sa.text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": app_role}).first():
        r = '"' + app_role.replace('"', "") + '"'
        for t in ("password_history", "admin_reset_requests"):
            op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO {r}")
    # Seed history with each user's current hash so "no reuse of the last 5" covers the password they have today.
    bind.execute(
        sa.text(
            "INSERT INTO password_history (id, user_id, password_hash, created_at) "
            "SELECT gen_random_uuid(), u.id, u.password_hash, coalesce(u.password_changed_at, now()) FROM users u "
            "WHERE NOT EXISTS (SELECT 1 FROM password_history h WHERE h.user_id = u.id)"
        )
    )
    for code, desc in PERMISSIONS.items():
        bind.execute(
            sa.text(
                "INSERT INTO permissions (id, code, description) SELECT gen_random_uuid(), CAST(:c AS varchar), :d "
                "WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = CAST(:c AS varchar))"
            ),
            {"c": code, "d": desc},
        )
        # ADMIN only (an existing database already has its roles; a fresh one gets them from the seed)
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN' AND p.code = :c "
                "AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)"
            ),
            {"c": code},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for code in PERMISSIONS:
        bind.execute(
            sa.text("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = :c)"),
            {"c": code},
        )
        bind.execute(sa.text("DELETE FROM permissions WHERE code = :c"), {"c": code})
    op.execute("DROP TABLE IF EXISTS admin_reset_requests")
    op.execute("DROP TABLE IF EXISTS password_history")
    for col in (
        "temp_password_expired_at",
        "temp_password_expires_at",
        "password_changed_at",
        "must_enroll_totp",
        "token_version",
    ):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")
