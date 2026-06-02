"""Add PM_SYSTEM_CONFIG (single-row global toggle).

One-column table holding a system-wide ENABLED_YN flag ('Y'/'N'). Seeded with
one row of 'N' so reads always find something. Oracle-oriented; SQLite tests
build the schema from the model via ``create_all``.

Revision ID: 0011
Revises: 0010
"""
from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE PM_SYSTEM_CONFIG (
            ENABLED_YN VARCHAR2(1) DEFAULT 'N' NOT NULL
        )
        """
    )
    op.execute("INSERT INTO PM_SYSTEM_CONFIG (ENABLED_YN) VALUES ('N')")


def downgrade() -> None:
    op.execute("DROP TABLE PM_SYSTEM_CONFIG CASCADE CONSTRAINTS PURGE")
