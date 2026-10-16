from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import User
from app.core.state_machine import member_sm
from app.members.models import Member, MemberStatusHistory


def set_status(session: AsyncSession, member: Member, to: str, user: User | None, reason: str | None) -> None:
    member_sm.check(member.status, to)
    old = member.status
    member.status = to
    session.add(
        MemberStatusHistory(
            member_id=member.id, from_status=old, to_status=to, changed_by=user.id if user else None, reason=reason
        )
    )
    audit.record(
        session,
        "STATUS_CHANGE",
        f"Member {member.membership_number}: {old} -> {to}" + (f" ({reason})" if reason else ""),
        entity_type="members",
        entity_id=member.id,
        entity_ref=member.membership_number,
        member_id=member.id,
        changes={"status": [old, to]},
    )
