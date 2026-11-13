import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamps, UUIDPk, Versioned, utcnow

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Permission(Base, UUIDPk):
    __tablename__ = "permissions"
    __audit_ref__ = "code"
    code: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")


class Role(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "roles"
    __audit_ref__ = "code"
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, lazy="selectin")


class User(Base, UUIDPk, Timestamps, Versioned):
    __tablename__ = "users"
    __audit_ref__ = "username"
    username: Mapped[str] = mapped_column(String(80), unique=True)
    full_name: Mapped[str] = mapped_column(String(150))
    email: Mapped[str | None] = mapped_column(String(255))
    mobile: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column()
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)  # Fernet-encrypted
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when 2FA is reset by an admin: the user must enrol again before using the app.
    must_enroll_totp: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Carried in every access/refresh token as "tv". Incrementing it ends every session on every device at once.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    password_changed_at: Mapped[datetime | None] = mapped_column()
    # A system-generated temporary password (admin reset / new user) is valid until this time.
    temp_password_expires_at: Mapped[datetime | None] = mapped_column()
    # When the expiry job recorded TEMP_PASSWORD_EXPIRED (keeps the job idempotent).
    temp_password_expired_at: Mapped[datetime | None] = mapped_column()
    last_login_at: Mapped[datetime | None] = mapped_column()
    # Extension point (OPEN_QUESTIONS #17): Entra ID object id for OIDC sign-in.
    external_subject: Mapped[str | None] = mapped_column(String(255), unique=True)
    roles: Mapped[list[Role]] = relationship(secondary=user_roles, lazy="selectin")

    def permission_codes(self) -> set[str]:
        return {p.code for r in self.roles for p in r.permissions}


class PasswordHistory(Base, UUIDPk):
    """bcrypt hashes of a user's previous self-chosen passwords (reuse check). Never plain text."""

    __tablename__ = "password_history"
    __audited__ = False
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow)


class AdminResetRequest(Base, UUIDPk):
    """A password reset of an ADMIN account: requested by one admin, approved by a different one (D-PW-3)."""

    __tablename__ = "admin_reset_requests"
    __audited__ = False  # every state change is recorded explicitly in the activity log
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow)
    target_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column()
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decision_reason: Mapped[str | None] = mapped_column(String(500))
    decided_at: Mapped[datetime | None] = mapped_column()


class RefreshToken(Base, UUIDPk):
    __tablename__ = "refresh_tokens"
    __audited__ = False
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column()
    revoked_at: Mapped[datetime | None] = mapped_column()
