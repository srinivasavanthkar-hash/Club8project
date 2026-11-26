"""SQLAlchemy base, common mixins, engine and per-request session dependency."""

import uuid
from collections.abc import AsyncIterator, Callable, Coroutine
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import Request, Response
from fastapi.routing import APIRoute
from sqlalchemy import DateTime, ForeignKey, Integer, MetaData, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

Money = Annotated[Decimal, mapped_column(Numeric(14, 2))]
Nights = Annotated[Decimal, mapped_column(Numeric(5, 1))]
Rate = Annotated[Decimal, mapped_column(Numeric(7, 4))]


def utcnow() -> datetime:
    """Column defaults (created_at, updated_at): the business clock (core/timeutil.now_utc)."""
    from app.core.timeutil import now_utc

    return now_utc()


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)
    type_annotation_map = {uuid.UUID: PG_UUID(as_uuid=True), datetime: DateTime(timezone=True)}

    # Marks tables whose changes are versioned into record_versions and the activity log.
    __audited__: bool = True
    # Human-readable reference attribute used in audit rows (e.g. "membership_number").
    __audit_ref__: str | None = None


class UUIDPk:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow, onupdate=utcnow)

    @declared_attr
    def created_by(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(ForeignKey("users.id", use_alter=True), nullable=True)

    @declared_attr
    def updated_by(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(ForeignKey("users.id", use_alter=True), nullable=True)


class Versioned:
    """Optimistic locking: SQLAlchemy raises StaleDataError on conflict -> HTTP 409."""

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:
        return {"version_id_col": cls.__table__.c.version}  # type: ignore[attr-defined]


class SoftDelete:
    deleted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    deleted_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    @declared_attr
    def deleted_by(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(ForeignKey("users.id", use_alter=True), nullable=True)


class EffectiveDated:
    effective_from: Mapped[date] = mapped_column(nullable=False)
    effective_to: Mapped[date | None] = mapped_column(nullable=True)


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        s = get_settings()
        _engine = create_async_engine(
            s.database_url.get_secret_value(), pool_pre_ping=True, pool_size=10, max_overflow=20
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, autoflush=True)
    return _engine


def set_engine(engine: AsyncEngine) -> None:
    """Used by tests to point the app at a testcontainers database."""
    global _engine, _sessionmaker
    _engine = engine
    _sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=True)


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    job = _job_sessionmaker.get()
    if job is not None:
        return job
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


# Background jobs: each runs in its own event loop (asyncio.run in a Dramatiq worker thread). asyncpg connections
# belong to the loop that opened them, so a pool shared across jobs hands one job another loop's connection
# ("attached to a different loop", "Event loop is closed"). A job gets its own engine instead, without a pool, closed
# when the job ends; sessionmaker() returns it for everything the job calls (contextvars are per thread and per loop).
_job_sessionmaker: ContextVar[async_sessionmaker[AsyncSession] | None] = ContextVar(
    "crm_job_sessionmaker", default=None
)


@asynccontextmanager
async def job_engine() -> AsyncIterator[AsyncEngine]:
    """An engine for one background job, on the same database as the app engine; disposed when the job ends."""
    engine = create_async_engine(get_engine().url, poolclass=NullPool)
    token = _job_sessionmaker.set(async_sessionmaker(engine, expire_on_commit=False, autoflush=True))
    try:
        yield engine
    finally:
        _job_sessionmaker.reset(token)
        await engine.dispose()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session + one transaction per request.

    The commit is performed by `TransactionalRoute` *before* the response is sent (FastAPI runs the
    teardown of yield-dependencies after the response, which would let a client see 201 before the
    data is committed, or miss a failed commit). Teardown here only rolls back what was not committed.
    """
    async with sessionmaker()() as session:
        request.state.db_session = session
        try:
            yield session
        except BaseException:
            await session.rollback()
            raise
        finally:
            if session.in_transaction():
                await session.rollback()


class TransactionalRoute(APIRoute):
    """Commits the request's session after the endpoint returns and before the response is sent.
    A failing commit raises, so the client receives the error instead of a false success."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def transactional(request: Request) -> Response:
            response = await handler(request)
            session: AsyncSession | None = getattr(request.state, "db_session", None)
            if session is not None and response.status_code < 400 and session.in_transaction():
                await session.commit()
            return response

        return transactional
