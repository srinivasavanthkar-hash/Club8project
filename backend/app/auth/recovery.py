"""Admin-initiated account recovery (docs/PASSWORD_PROMPT.md Section 3, decisions D-PW-1..5 in docs/DECISIONS.md).

* Temporary passwords are always system-generated, shown once, valid for `password.temp_expiry_hours` and force a
  change at next sign-in. Admins never choose, see again or set a user's real password.
* Admins cannot reset their own password or 2FA here.
* Resetting another ADMIN's password needs a second admin's approval within `password.admin_reset_approval_hours`.
  Fallback: when fewer than two active admins other than the target exist (so nobody could approve), the designated
  super-admin (CRM_SUPER_ADMIN_USERNAME, configuration only) may reset directly. That reset is flagged in the log.
* A password reset never touches 2FA; "Reset 2FA" is a separate action and permission.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import AdminResetRequest, Role, User, user_roles
from app.auth.notify import security_notice
from app.auth.policy import KEYS as POLICY_KEYS
from app.auth.policy import generate_temporary_password
from app.auth.service import revoke_all_sessions
from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NotFound
from app.core.security import hash_password
from app.core.settings_store import get_setting, get_settings_map
from app.core.timeutil import fmt_dt_ist, now_utc

ADMIN = "ADMIN"


@dataclass(frozen=True)
class TemporaryPassword:
    password: str  # returned to the admin exactly once; never stored, logged or audited
    expires_at: datetime


@dataclass(frozen=True)
class ResetOutcome:
    temporary: TemporaryPassword | None = None  # option B
    link_sent_to: str | None = None  # option A: masked registered address the reset link went to
    request: AdminResetRequest | None = None  # set when an ADMIN reset is waiting for a second admin
    super_admin: bool = False


METHODS = ("TEMP_PASSWORD", "EMAIL_LINK")  # option B, option A


def is_admin(user: User) -> bool:
    return any(r.code == ADMIN for r in user.roles)


def _audit(session: AsyncSession, action: str, summary: str, target: User) -> None:
    audit.record(session, action, summary, entity_type="users", entity_id=target.id, entity_ref=target.username)


async def _target(session: AsyncSession, user_id: uuid.UUID) -> User:
    u = await session.get(User, user_id, with_for_update=True)
    if u is None:
        raise NotFound("User not found")
    return u


async def _other_active_admins(session: AsyncSession, target: User) -> int:
    return int(
        (
            await session.execute(
                select(func.count(func.distinct(User.id)))
                .join(user_roles, user_roles.c.user_id == User.id)
                .join(Role, Role.id == user_roles.c.role_id)
                .where(Role.code == ADMIN, User.is_active.is_(True), User.id != target.id)
            )
        ).scalar_one()
    )


async def issue_temporary_password(
    session: AsyncSession, target: User, *, why: str, end_sessions: bool = True
) -> TemporaryPassword:
    """Replace the password with a generated one that must be changed at next sign-in. Ends every session (not
    needed for a brand-new user) and clears any lockout. 2FA is left exactly as it is."""
    cfg = await get_settings_map(session, POLICY_KEYS)
    pw = generate_temporary_password(target.username, target.full_name, cfg)
    hours = int(await get_setting(session, "password.temp_expiry_hours"))
    expires = now_utc() + timedelta(hours=hours)
    target.password_hash = hash_password(pw)
    target.must_change_password = True
    target.temp_password_expires_at = expires
    target.temp_password_expired_at = None
    if target.locked_until or target.failed_logins:
        _audit(session, "LOCKOUT_CLEARED", f"Lockout of {target.username} cleared ({why})", target)
    target.failed_logins = 0
    target.locked_until = None
    if end_sessions:
        await revoke_all_sessions(session, target, why)
    _audit(
        session,
        "TEMP_PASSWORD_ISSUED",
        f"Temporary password issued for {target.username} ({why}); valid until {fmt_dt_ist(expires)} IST",
        target,
    )
    return TemporaryPassword(pw, expires)


async def _perform(session: AsyncSession, actor: User, target: User, method: str, why: str) -> ResetOutcome:
    """Carry out an admin reset. Both options end every session and notify the user by email when they have one.
    Neither touches 2FA."""
    if method == "EMAIL_LINK":
        if not target.email:
            raise Conflict("This user has no registered email. Use a temporary password instead.", code="NoEmail")
        from app.auth.reset import issue_reset_link
        from app.email.dispatch import mask_address

        await revoke_all_sessions(session, target, why)
        await issue_reset_link(session, target, purpose="ADMIN_LINK", created_by=actor.id)
        return ResetOutcome(link_sent_to=mask_address(target.email))
    temp = await issue_temporary_password(session, target, why=why)
    security_notice(
        session,
        target,
        "An administrator reset your password",
        "Your administrator will give you a temporary password in person or by phone. "
        "We never send passwords by email.",
    )
    return ResetOutcome(temporary=temp)


async def reset_password(
    session: AsyncSession, actor: User, target_id: uuid.UUID, reason: str, method: str = "TEMP_PASSWORD"
) -> ResetOutcome:
    """Option A (`EMAIL_LINK`, a reset link to the registered email) or option B (`TEMP_PASSWORD`)."""
    if method not in METHODS:
        raise Conflict("Unknown reset method", code="UnknownMethod")
    target = await _target(session, target_id)
    if target.id == actor.id:
        raise Forbidden(
            "You can't reset your own password here. Use Change password instead.", code="CannotResetOwnPassword"
        )
    if not target.is_active:
        raise Conflict("This account is inactive. Activate it first.", code="UserInactive")
    if method == "EMAIL_LINK" and not target.email:
        raise Conflict("This user has no registered email. Use a temporary password instead.", code="NoEmail")
    option = "option A: reset link emailed" if method == "EMAIL_LINK" else "option B: temporary password"
    if not is_admin(target):
        _audit(
            session,
            "PASSWORD_RESET_BY_ADMIN",
            f"Password of {target.username} reset ({option}; reason: {reason})",
            target,
        )
        return await _perform(session, actor, target, method, "admin reset")

    # ADMIN target: second-admin approval, or the super-admin fallback when no second admin exists.
    others = await _other_active_admins(session, target)
    if others < 2:
        super_admin = (get_settings().super_admin_username or "").strip().lower()
        if not super_admin or actor.username != super_admin:
            raise Forbidden(
                "Resetting an administrator needs a second administrator to approve, and there isn't one. "
                "Only the designated super-admin can do this.",
                code="ApprovalUnavailable",
            )
        _audit(
            session,
            "PASSWORD_RESET_SUPER_ADMIN",
            f"[SUPER-ADMIN FALLBACK] Administrator {target.username} reset directly by super-admin "
            f"{actor.username}: no second admin available to approve ({option}; reason: {reason})",
            target,
        )
        out = await _perform(session, actor, target, method, "super-admin reset")
        return ResetOutcome(temporary=out.temporary, link_sent_to=out.link_sent_to, super_admin=True)
    await expire_reset_requests(session)
    pending = (
        await session.execute(
            select(AdminResetRequest).where(
                AdminResetRequest.target_user_id == target.id, AdminResetRequest.status == "PENDING"
            )
        )
    ).scalar_one_or_none()
    if pending is not None:
        raise Conflict("A reset of this administrator is already waiting for approval.", code="ResetAlreadyPending")
    hours = int(await get_setting(session, "password.admin_reset_approval_hours"))
    req = AdminResetRequest(
        target_user_id=target.id,
        requested_by=actor.id,
        reason=reason,
        method=method,
        expires_at=now_utc() + timedelta(hours=hours),
    )
    session.add(req)
    await session.flush()
    _audit(
        session,
        "ADMIN_RESET_REQUESTED",
        f"Reset of administrator {target.username} requested ({option}); needs a different admin's approval within "
        f"{hours} h (reason: {reason})",
        target,
    )
    return ResetOutcome(request=req)


async def _request(session: AsyncSession, request_id: uuid.UUID) -> tuple[AdminResetRequest, User]:
    req = await session.get(AdminResetRequest, request_id, with_for_update=True)
    if req is None:
        raise NotFound("Request not found")
    if req.status == "PENDING" and req.expires_at <= now_utc():
        target = await _target(session, req.target_user_id)
        _expire(session, req, target)
    if req.status != "PENDING":
        raise Conflict(f"This request is no longer pending ({req.status.lower()}).", code="RequestNotPending")
    return req, await _target(session, req.target_user_id)


async def approve_request(session: AsyncSession, actor: User, request_id: uuid.UUID, reason: str) -> ResetOutcome:
    req, target = await _request(session, request_id)
    if actor.id in (req.requested_by, req.target_user_id):
        raise Forbidden("A different administrator must approve this reset.", code="SameAdmin")
    if not is_admin(actor):
        raise Forbidden("Only an administrator can approve this reset.", code="NotAdmin")
    if not target.is_active:
        raise Conflict("This account is inactive. Activate it first.", code="UserInactive")
    req.status, req.decided_by, req.decision_reason, req.decided_at = "APPROVED", actor.id, reason, now_utc()
    _audit(
        session,
        "ADMIN_RESET_APPROVED",
        f"Reset of administrator {target.username} approved by {actor.username} (reason: {reason})",
        target,
    )
    option = "option A: reset link emailed" if req.method == "EMAIL_LINK" else "option B: temporary password"
    _audit(
        session,
        "PASSWORD_RESET_BY_ADMIN",
        f"Password of {target.username} reset ({option}; reason: {req.reason})",
        target,
    )
    return await _perform(session, actor, target, req.method, "admin reset, approved")


async def reject_request(session: AsyncSession, actor: User, request_id: uuid.UUID, reason: str) -> AdminResetRequest:
    """A different admin rejects it; the requester can withdraw it (CANCELLED)."""
    req, target = await _request(session, request_id)
    if actor.id == req.target_user_id:
        raise Forbidden("You can't decide on a reset of your own account.", code="SameAdmin")
    cancelled = actor.id == req.requested_by
    req.status = "CANCELLED" if cancelled else "REJECTED"
    req.decided_by, req.decision_reason, req.decided_at = actor.id, reason, now_utc()
    _audit(
        session,
        "ADMIN_RESET_CANCELLED" if cancelled else "ADMIN_RESET_REJECTED",
        f"Reset of administrator {target.username} {'withdrawn' if cancelled else 'rejected'} by {actor.username} "
        f"(reason: {reason})",
        target,
    )
    return req


def _expire(session: AsyncSession, req: AdminResetRequest, target: User) -> None:
    req.status, req.decided_at = "EXPIRED", now_utc()
    _audit(session, "ADMIN_RESET_EXPIRED", f"Reset request for administrator {target.username} expired", target)


async def expire_reset_requests(session: AsyncSession) -> int:
    """Idempotent: PENDING requests past their deadline become EXPIRED (one log entry each)."""
    rows = list(
        (
            await session.execute(
                select(AdminResetRequest)
                .where(AdminResetRequest.status == "PENDING", AdminResetRequest.expires_at <= now_utc())
                .with_for_update()
            )
        ).scalars()
    )
    for req in rows:
        _expire(session, req, await _target(session, req.target_user_id))
    return len(rows)


async def expire_temporary_passwords(session: AsyncSession) -> int:
    """Idempotent: records TEMP_PASSWORD_EXPIRED once for each unused temporary password past its expiry. Sign-in
    with an expired temporary password is refused whether or not this job has run."""
    rows = list(
        (
            await session.execute(
                select(User)
                .where(
                    User.temp_password_expires_at <= now_utc(),
                    User.temp_password_expired_at.is_(None),
                    User.must_change_password.is_(True),
                )
                .with_for_update()
            )
        ).scalars()
    )
    for u in rows:
        u.temp_password_expired_at = now_utc()
        _audit(session, "TEMP_PASSWORD_EXPIRED", f"Unused temporary password of {u.username} expired", u)
    return len(rows)


async def reset_totp(session: AsyncSession, actor: User, target_id: uuid.UUID, reason: str) -> User:
    target = await _target(session, target_id)
    if target.id == actor.id:
        raise Forbidden("You can't reset your own two-step verification.", code="CannotResetOwn2FA")
    if not target.totp_enabled and not target.totp_secret_enc:
        raise Conflict("Two-step verification isn't set up for this user.", code="TotpNotEnabled")
    target.totp_enabled = False
    target.totp_secret_enc = None
    target.must_enroll_totp = True  # enrol again at next sign-in, before anything else is reachable
    await revoke_all_sessions(session, target, "2FA reset")
    _audit(
        session,
        "TOTP_RESET_BY_ADMIN",
        f"2FA of {target.username} reset by {actor.username}; must enrol again at next sign-in (reason: {reason})",
        target,
    )
    security_notice(
        session,
        target,
        "An administrator reset your two-step verification",
        "You'll set it up again with your authenticator app the next time you sign in.",
    )
    return target


async def pending_requests(session: AsyncSession) -> list[tuple[AdminResetRequest, User, User]]:
    await expire_reset_requests(session)
    rows = (
        await session.execute(
            select(AdminResetRequest)
            .where(AdminResetRequest.status == "PENDING")
            .order_by(AdminResetRequest.created_at)
        )
    ).scalars()
    out = []
    for req in rows:
        target = await session.get(User, req.target_user_id)
        requester = await session.get(User, req.requested_by)
        if target and requester:
            out.append((req, target, requester))
    return out
