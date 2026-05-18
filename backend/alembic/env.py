from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.core.db import Base
from app.models import (  # noqa: F401  -- ensure metadata is populated
    audit,
    dataset,
    edge,
    node,
    project,
    prompt,
    prompt_variable,
    ragas,
    test_run,
)

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

settings = get_settings()
# python-oracledb DSN form: oracle+oracledb://user:password@host:port/?service_name=...
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url())

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
