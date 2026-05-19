"""phase 4: ragas judge/metrics columns + per-case results

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-19 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("PM_RAGAS_RUN", sa.Column("JUDGE_PROVIDER", sa.String(50)))
    op.add_column("PM_RAGAS_RUN", sa.Column("JUDGE_MODEL", sa.String(100)))
    op.add_column("PM_RAGAS_RUN", sa.Column("METRICS", sa.Text))
    op.add_column("PM_RAGAS_RUN", sa.Column("ENGINE", sa.String(20)))
    op.add_column("PM_RAGAS_RUN", sa.Column("ERROR_MSG", sa.Text))

    op.create_table(
        "PM_RAGAS_RESULT",
        sa.Column("RAGAS_RESULT_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("RAGAS_RUN_ID", sa.Integer, sa.ForeignKey("PM_RAGAS_RUN.RAGAS_RUN_ID"), nullable=False),
        sa.Column("CASE_ID", sa.Integer, sa.ForeignKey("PM_TEST_CASE.CASE_ID")),
        sa.Column("QUESTION", sa.Text),
        sa.Column("ANSWER", sa.Text),
        sa.Column("CONTEXTS", sa.Text),
        sa.Column("GROUND_TRUTH", sa.Text),
        sa.Column("FAITHFULNESS", sa.Numeric(5, 4)),
        sa.Column("ANSWER_RELEVANCY", sa.Numeric(5, 4)),
        sa.Column("CONTEXT_PRECISION", sa.Numeric(5, 4)),
        sa.Column("CONTEXT_RECALL", sa.Numeric(5, 4)),
        sa.Column("ANSWER_CORRECTNESS", sa.Numeric(5, 4)),
        sa.Column("ERROR_MSG", sa.Text),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )
    op.create_index("IDX_PM_RAGAS_RESULT_RUN", "PM_RAGAS_RESULT", ["RAGAS_RUN_ID"])


def downgrade() -> None:
    op.drop_index("IDX_PM_RAGAS_RESULT_RUN", table_name="PM_RAGAS_RESULT")
    op.drop_table("PM_RAGAS_RESULT")
    for col in ("ERROR_MSG", "ENGINE", "METRICS", "JUDGE_MODEL", "JUDGE_PROVIDER"):
        op.drop_column("PM_RAGAS_RUN", col)
