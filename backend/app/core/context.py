"""Request context propagated through contextvars (user, IP, user agent, request id)."""

import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RequestContext:
    request_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    user_id: uuid.UUID | None = None
    username: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    reason: str | None = None  # optional correction reason supplied via X-Change-Reason header


_ctx: ContextVar[RequestContext] = ContextVar("crm_request_ctx", default=RequestContext())  # noqa: B039 - frozen


def get_context() -> RequestContext:
    return _ctx.get()


def set_context(ctx: RequestContext) -> None:
    _ctx.set(ctx)


def with_user(user_id: uuid.UUID, username: str) -> None:
    c = _ctx.get()
    _ctx.set(
        RequestContext(
            request_id=c.request_id,
            user_id=user_id,
            username=username,
            ip=c.ip,
            user_agent=c.user_agent,
            reason=c.reason,
        )
    )


def with_reason(reason: str | None) -> None:
    c = _ctx.get()
    _ctx.set(
        RequestContext(
            request_id=c.request_id,
            user_id=c.user_id,
            username=c.username,
            ip=c.ip,
            user_agent=c.user_agent,
            reason=reason,
        )
    )
