"""Hash chain for the append-only activity log.

hash_n = SHA-256( prev_hash_{n-1} || canonical_json(entry_n) ). Changing, inserting or deleting any
row breaks every following hash; `verify_chain` reports the first broken sequence number.
"""

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

GENESIS = "0" * 64
HASHED_FIELDS = (
    "seq",
    "occurred_at",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "entity_ref",
    "member_id",
    "summary",
    "changes",
    "ip",
    "user_agent",
)


def _default(o: Any) -> Any:
    if isinstance(o, datetime):
        return o.isoformat(timespec="microseconds")
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, (Decimal, UUID)):
        return str(o)
    raise TypeError(f"Unserialisable {type(o)}")


def canonical(entry: Mapping[str, Any]) -> str:
    payload = {k: entry.get(k) for k in HASHED_FIELDS}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=_default, ensure_ascii=False)


def compute_hash(prev_hash: str, entry: Mapping[str, Any]) -> str:
    return hashlib.sha256((prev_hash + canonical(entry)).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChainVerification:
    ok: bool
    checked: int
    first_broken_seq: int | None = None
    message: str = ""


def verify_chain(rows: Iterable[Mapping[str, Any]]) -> ChainVerification:
    prev = GENESIS
    n = 0
    expected_seq = None
    for row in rows:
        n += 1
        if expected_seq is not None and row["seq"] != expected_seq:
            return ChainVerification(False, n, row["seq"], f"Gap in sequence: expected {expected_seq}")
        if row["prev_hash"] != prev:
            return ChainVerification(False, n, row["seq"], "prev_hash does not match previous entry")
        if compute_hash(prev, row) != row["hash"]:
            return ChainVerification(False, n, row["seq"], "content hash mismatch (row altered)")
        prev = row["hash"]
        expected_seq = row["seq"] + 1
    return ChainVerification(True, n, None, "chain intact")
