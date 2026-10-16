"""Central audit + versioning.

* `record()` queues a semantic activity event (login, approve, export, KYC view, ...).
* SQLAlchemy `after_flush` captures field-level old/new values for every audited model into
  `record_versions` and queues a CREATE/UPDATE/DELETE activity event.
* `before_commit` flushes, then appends all queued events to `activity_log` under a transaction-level
  advisory lock so the hash chain stays linear. Nothing is written if the transaction rolls back.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import event, insert, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.audit.hashchain import GENESIS, ChainVerification, compute_hash, verify_chain
from app.audit.models import ActivityLog, RecordVersion
from app.core.context import get_context
from app.core.db import Base, utcnow

AUDIT_LOCK_KEY = 815_001  # arbitrary constant for pg_advisory_xact_lock
REDACTED = "***"
SENSITIVE_COLUMNS = {"password_hash", "value_encrypted", "totp_secret_enc", "lookup_hash"}
SKIP_COLUMNS = {"version", "updated_at", "updated_by", "created_at", "created_by"}
_PENDING = "audit_pending"


def _jsonable(v: Any) -> Any:
    if isinstance(v, (Decimal, uuid.UUID)):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    return v


def record(
    session: AsyncSession | Session,
    action: str,
    summary: str,
    *,
    entity_type: str | None = None,
    entity_id: Any = None,
    entity_ref: str | None = None,
    member_id: uuid.UUID | None = None,
    changes: dict[str, Any] | None = None,
) -> None:
    sync = session.sync_session if isinstance(session, AsyncSession) else session
    sync.info.setdefault(_PENDING, []).append(
        {
            "action": action,
            "summary": summary,
            "entity_type": entity_type,
            "entity_id": str(entity_id) if entity_id is not None else None,
            "entity_ref": entity_ref,
            "member_id": member_id,
            "changes": _jsonable(changes) if changes else None,
        }
    )


def _entity_type(obj: Any) -> str:
    return str(obj.__table__.name)


def _member_id(obj: Any) -> uuid.UUID | None:
    if obj.__table__.name == "members":
        return obj.id  # type: ignore[no-any-return]
    mid = getattr(obj, "member_id", None)
    return mid if isinstance(mid, uuid.UUID) else None


def _ref(obj: Any) -> str | None:
    attr = getattr(obj, "__audit_ref__", None)
    val = getattr(obj, attr, None) if attr else None
    return str(val) if val is not None else None


def _diff(obj: Any, op: str) -> tuple[dict[str, Any], dict[str, Any]]:
    state = inspect(obj)
    old: dict[str, Any] = {}
    new: dict[str, Any] = {}
    for col in state.mapper.column_attrs:
        key = col.key
        if key in SKIP_COLUMNS:
            continue
        hist = state.attrs[key].history
        if op == "INSERT":
            val = getattr(obj, key)
            if val is not None:
                new[key] = REDACTED if key in SENSITIVE_COLUMNS else _jsonable(val)
        elif hist.has_changes():
            before = hist.deleted[0] if hist.deleted else None
            after = hist.added[0] if hist.added else None
            if before == after:
                continue
            old[key] = REDACTED if key in SENSITIVE_COLUMNS else _jsonable(before)
            new[key] = REDACTED if key in SENSITIVE_COLUMNS else _jsonable(after)
    return old, new


def _after_flush(session: Session, _ctx: Any) -> None:
    ctx = get_context()
    reason = session.info.get("reason") or ctx.reason
    versions = []
    for op, objs in (("INSERT", session.new), ("UPDATE", session.dirty)):
        for obj in objs:
            if not isinstance(obj, Base) or not getattr(obj, "__audited__", True):
                continue
            if op == "UPDATE" and not session.is_modified(obj, include_collections=False):
                continue
            old, new = _diff(obj, op)
            if op == "UPDATE" and not new:
                continue
            real_op = op
            if op == "UPDATE" and "deleted_at" in new and new["deleted_at"] is not None:
                real_op = "DELETE"
            identity = inspect(obj).identity
            pk = str(identity[0]) if identity else str(getattr(obj, "id", ""))
            versions.append(
                {
                    "table_name": _entity_type(obj),
                    "record_id": pk,
                    "member_id": _member_id(obj),
                    "operation": real_op,
                    "changed_at": utcnow(),
                    "changed_by": ctx.user_id,
                    "reason": reason,
                    "old_values": old or None,
                    "new_values": new or None,
                    "request_id": ctx.request_id,
                }
            )
            verb = {"INSERT": "Created", "UPDATE": "Updated", "DELETE": "Deleted"}[real_op]
            ref = _ref(obj)
            fields = ", ".join(sorted(new)) if real_op == "UPDATE" else ""
            record(
                session,
                real_op,
                f"{verb} {_entity_type(obj)}{' ' + ref if ref else ''}"
                f"{': ' + fields if fields else ''}{' (reason: ' + reason + ')' if reason else ''}",
                entity_type=_entity_type(obj),
                entity_id=pk,
                entity_ref=ref,
                member_id=_member_id(obj),
                changes={k: [old.get(k), new.get(k)] for k in new} if real_op != "INSERT" else None,
            )
    if versions:
        session.connection().execute(insert(RecordVersion), versions)


def _before_commit(session: Session) -> None:
    session.flush()
    pending: list[dict[str, Any]] = session.info.pop(_PENDING, [])
    if not pending:
        return
    conn = session.connection()
    ctx = get_context()
    conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": AUDIT_LOCK_KEY})
    last = conn.execute(select(ActivityLog.seq, ActivityLog.hash).order_by(ActivityLog.seq.desc()).limit(1)).first()
    seq, prev = (last[0], last[1]) if last else (0, GENESIS)
    rows = []
    for p in pending:
        seq += 1
        row = {
            "seq": seq,
            "occurred_at": utcnow(),
            "user_id": ctx.user_id,
            "username": ctx.username,
            "ip": ctx.ip,
            "user_agent": (ctx.user_agent or "")[:400] or None,
            "request_id": ctx.request_id,
            **p,
        }
        row["prev_hash"] = prev
        row["hash"] = compute_hash(prev, row)
        prev = row["hash"]
        rows.append(row)
    conn.execute(insert(ActivityLog), rows)


def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING, None)


def install_session_hooks() -> None:
    if not event.contains(Session, "after_flush", _after_flush):
        event.listen(Session, "after_flush", _after_flush)
        event.listen(Session, "before_commit", _before_commit)
        event.listen(Session, "after_soft_rollback", lambda s, _t: _after_rollback(s))


async def verify_integrity(session: AsyncSession, batch: int = 5000) -> ChainVerification:
    """Streams the whole log in seq order and verifies the chain."""
    rows: list[dict[str, Any]] = []
    res = await session.stream(select(ActivityLog).order_by(ActivityLog.seq).execution_options(yield_per=batch))
    async for (r,) in res:
        rows.append(
            {
                "seq": r.seq,
                "occurred_at": r.occurred_at,
                "user_id": r.user_id,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "entity_ref": r.entity_ref,
                "member_id": r.member_id,
                "summary": r.summary,
                "changes": r.changes,
                "ip": r.ip,
                "user_agent": r.user_agent,
                "prev_hash": r.prev_hash,
                "hash": r.hash,
            }
        )
    return verify_chain(rows)


def history_for(table: str, record_id: str) -> Any:
    return (
        select(RecordVersion)
        .where(RecordVersion.table_name == table, RecordVersion.record_id == record_id)
        .order_by(RecordVersion.id)
    )


def member_trail(member_id: uuid.UUID) -> Any:
    return select(ActivityLog).where(ActivityLog.member_id == member_id).order_by(ActivityLog.seq)


__all__: Sequence[str] = ["install_session_hooks", "record", "verify_integrity"]
