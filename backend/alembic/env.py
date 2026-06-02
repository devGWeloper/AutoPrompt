from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.core.db import Base
from app.models import (  # noqa: F401  -- ensure metadata is populated
    audit,
    dataset,
    node_prompt_ver,
    ragas,
)

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

settings = get_settings()
# Bare oracle+oracledb URL; the real user/password/dsn go through connect_args
# (see run_migrations_online). Offline --sql mode never connects, so url-only is ok.
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
        connect_args=settings.oracle_connect_args(),
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
