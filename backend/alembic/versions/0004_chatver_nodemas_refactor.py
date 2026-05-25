"""Refactor to CHAT_VER_MAS / NODE_MAS centric schema (single flow + flow versioning).

Drops the old project-centric PM_* tables (PM_PROJECT / PM_NODE / PM_NODE_EDGE /
PM_PROMPT_VERSION) and the prompt/test/ragas tables that referenced them, then
recreates the re-anchored PM_* tables from the current SQLAlchemy metadata.

The two FIXED external tables CHAT_VER_MAS and NODE_MAS are **assumed to already
exist** (owned by the operational project). This migration never creates or alters
them. PM_AUDIT_LOG is unchanged and left in place.

Oracle-oriented (uses CASCADE CONSTRAINTS PURGE). The test suite builds the schema
via Base.metadata.create_all on SQLite, not via this migration.

Revision ID: 0004
Revises: 0003
"""
from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# FK-safe drop order (children first). Old re-anchored tables are dropped too so
# they can be recreated with the new column layout.
_DROP_ORDER = [
    "PM_RAGAS_RESULT",
    "PM_RAGAS_RUN",
    "PM_TEST_RESULT",
    "PM_TEST_RUN",
    "PM_TEST_CASE",
    "PM_TEST_DATASET",
    "PM_PROMPT_VARIABLE",
    "PM_PROMPT_VERSION",
    "PM_NODE_EDGE",
    "PM_NODE",
    "PM_PROJECT",
]

# Recreated from metadata, in dependency order (PM_AUDIT_LOG already exists).
_CREATE = [
    "PM_NODE_PROMPT_VER",
    "PM_FLOW_VER",
    "PM_FLOW_VER_NODE",
    "PM_PROMPT_VARIABLE",
    "PM_TEST_DATASET",
    "PM_TEST_CASE",
    "PM_TEST_RUN",
    "PM_TEST_RESULT",
    "PM_RAGAS_RUN",
    "PM_RAGAS_RESULT",
]


def _drop_if_exists(table: str) -> None:
    op.execute(
        f"""
BEGIN EXECUTE IMMEDIATE 'DROP TABLE {table} CASCADE CONSTRAINTS PURGE';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
"""
    )


def upgrade() -> None:
    import app.models  # noqa: F401  -- populate metadata
    from app.core.db import Base

    for table in _DROP_ORDER:
        _drop_if_exists(table)

    bind = op.get_bind()
    tables = [Base.metadata.tables[name] for name in _CREATE]
    Base.metadata.create_all(bind, tables=tables)


def downgrade() -> None:
    # One-way refactor; recreating the old project-centric schema is out of scope.
    raise NotImplementedError("0004 refactor is not reversible")
