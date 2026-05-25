"""Allow FLOW-scoped RAGAS runs.

Makes PM_RAGAS_RUN.NODE_MAS_ID / PROMPT_ID nullable (a flow-level RAGAS run has no
single node/prompt target) and adds CHAT_VER_ID. Oracle-oriented; SQLite tests
build the schema from the models via create_all.

Revision ID: 0005
Revises: 0004
"""
from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE PM_RAGAS_RUN MODIFY (NODE_MAS_ID NUMBER NULL, PROMPT_ID NUMBER NULL)")
    op.execute("ALTER TABLE PM_RAGAS_RUN ADD (CHAT_VER_ID NUMBER)")
    op.execute(
        "ALTER TABLE PM_RAGAS_RUN ADD CONSTRAINT FK_PM_RAGAS_RUN_CHATVER "
        "FOREIGN KEY (CHAT_VER_ID) REFERENCES CHAT_VER_MAS (ID)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE PM_RAGAS_RUN DROP CONSTRAINT FK_PM_RAGAS_RUN_CHATVER")
    op.execute("ALTER TABLE PM_RAGAS_RUN DROP COLUMN CHAT_VER_ID")
    op.execute("ALTER TABLE PM_RAGAS_RUN MODIFY (NODE_MAS_ID NUMBER NOT NULL, PROMPT_ID NUMBER NOT NULL)")
