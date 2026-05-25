"""Add PM_TEST_RUN.AB_GROUP_ID to link a flow A/B pair.

The two runs of a flow A/B test share one AB_GROUP_ID (the A run's id) so the
records UI can collapse them into a single row. NULL for all other run types.
Oracle-oriented; SQLite tests build the schema from the models via create_all.

Revision ID: 0007
Revises: 0006
"""
from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE PM_TEST_RUN ADD (AB_GROUP_ID NUMBER)")


def downgrade() -> None:
    op.execute("ALTER TABLE PM_TEST_RUN DROP COLUMN AB_GROUP_ID")
