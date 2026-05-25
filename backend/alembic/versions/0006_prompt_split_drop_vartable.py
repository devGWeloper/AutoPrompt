"""Split node prompt into SYSTEM_PROMPT/USER_PROMPT and drop PM_PROMPT_VARIABLE.

PM_NODE_PROMPT_VER.PROMPT (single column) becomes two PM-owned columns
SYSTEM_PROMPT + USER_PROMPT. On activation only SYSTEM_PROMPT is mirrored into the
fixed NODE_MAS.PROMPT (it maps to the agent's session_system_prompt); USER_PROMPT
stays in PM as the test-time message template. Existing prompt text is backfilled
into SYSTEM_PROMPT. PM_PROMPT_VARIABLE (the {{var}} catalog) is removed — it was
never read by the test path.

Oracle-oriented. NODE_MAS is never altered. The test suite builds the schema from
the models via Base.metadata.create_all on SQLite, not via this migration.

Revision ID: 0006
Revises: 0005
"""
from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def _drop_if_exists(table: str) -> None:
    op.execute(
        f"""
BEGIN EXECUTE IMMEDIATE 'DROP TABLE {table} CASCADE CONSTRAINTS PURGE';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
"""
    )


def upgrade() -> None:
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER ADD (SYSTEM_PROMPT CLOB, USER_PROMPT CLOB)")
    op.execute("UPDATE PM_NODE_PROMPT_VER SET SYSTEM_PROMPT = PROMPT")
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER DROP COLUMN PROMPT")
    _drop_if_exists("PM_PROMPT_VARIABLE")


def downgrade() -> None:
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER ADD (PROMPT CLOB)")
    op.execute("UPDATE PM_NODE_PROMPT_VER SET PROMPT = SYSTEM_PROMPT")
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER DROP COLUMN SYSTEM_PROMPT")
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER DROP COLUMN USER_PROMPT")
    # PM_PROMPT_VARIABLE is not recreated (one-way removal).
