import asyncio

from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.core.config import get_settings
from app.models import metadata

config = context.config


def _url() -> str:
    s = get_settings()
    url = config.attributes.get("url") or (s.migration_database_url or s.database_url).get_secret_value()
    return str(url)


def do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as conn:
        await conn.run_sync(do_run)
    await engine.dispose()


def run_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        do_run(connection)
    else:
        asyncio.run(run_async())


if context.is_offline_mode():
    context.configure(url=_url(), target_metadata=metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    run_online()
