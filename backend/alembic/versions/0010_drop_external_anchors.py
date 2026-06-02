"""Drop external anchors; PM owns node identity via NODE_NM.

Removes FKs/columns that pointed at the operational CHAT_VER_MAS / NODE_MAS
tables, so PM is fully self-contained:

- ``PM_NODE_PROMPT_VER.NODE_MAS_ID`` → dropped. Node identity is now ``NODE_NM``
  (already on the table). Unique key switched from (NODE_MAS_ID, VERSION_NO) to
  (NODE_NM, VERSION_NO).
- ``PM_NODE_PROMPT_VER.MODEL_NM`` → added (the model is now versioned with the
  prompt and editable here too).
- ``PM_TEST_DATASET.NODE_MAS_ID`` + ``SCOPE`` → dropped (FLOW-scope only).
- ``PM_RAGAS_RUN.CHAT_VER_ID`` + ``NODE_MAS_ID`` → dropped (single-flow
  assumption; A/B comparison still keys on PROMPT_ID).

Oracle-oriented; SQLite tests build the schema from the models via create_all.

Revision ID: 0010
Revises: 0009
"""
from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PM_NODE_PROMPT_VER: identity NODE_MAS_ID → NODE_NM, add MODEL_NM.
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER DROP CONSTRAINT UQ_PM_NODE_PROMPT_VER")
    # Dropping the column also drops the FK constraint backing it (Oracle).
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER DROP (NODE_MAS_ID)")
    op.execute(
        "ALTER TABLE PM_NODE_PROMPT_VER ADD CONSTRAINT UQ_PM_NODE_PROMPT_VER "
        "UNIQUE (NODE_NM, VERSION_NO)"
    )
    op.execute("ALTER TABLE PM_NODE_PROMPT_VER ADD (MODEL_NM VARCHAR2(100))")

    # PM_TEST_DATASET: FLOW-only, no node anchor.
    op.execute("ALTER TABLE PM_TEST_DATASET DROP (NODE_MAS_ID, SCOPE)")

    # PM_RAGAS_RUN: single-flow assumption, no external anchors.
    op.execute("ALTER TABLE PM_RAGAS_RUN DROP (CHAT_VER_ID, NODE_MAS_ID)")


def downgrade() -> None:
    # Reintroducing FKs to CHAT_VER_MAS / NODE_MAS requires those external tables
    # to exist in this DB, which is no longer the design.
    raise NotImplementedError("0010 is not reversible (external anchors removed)")
