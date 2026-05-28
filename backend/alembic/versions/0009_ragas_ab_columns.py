"""RAGAS version A/B comparison columns on PM_RAGAS_RUN.

Re-adds NODE_MAS_ID / PROMPT_ID (which node prompt version a run evaluated) and adds
AB_GROUP_ID (links the two runs of one comparison = the A run's id). All NULL for a
plain single RAGAS run. Oracle-oriented; SQLite tests build the schema from models.

Revision ID: 0009
Revises: 0008
"""
from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE PM_RAGAS_RUN ADD ("
        "NODE_MAS_ID NUMBER REFERENCES NODE_MAS(ID), "
        "PROMPT_ID NUMBER REFERENCES PM_NODE_PROMPT_VER(PROMPT_ID), "
        "AB_GROUP_ID NUMBER)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE PM_RAGAS_RUN DROP (NODE_MAS_ID, PROMPT_ID, AB_GROUP_ID)")
