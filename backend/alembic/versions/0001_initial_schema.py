"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-15 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id_col() -> sa.Column:
    return sa.Column(
        "id_placeholder", sa.Integer, sa.Identity(always=True), primary_key=True
    )


def upgrade() -> None:
    op.create_table(
        "PM_PROJECT",
        sa.Column("PROJECT_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("PROJECT_NM", sa.String(100), nullable=False),
        sa.Column("DESCRIPTION", sa.String(500)),
        sa.Column("STATUS", sa.String(20), server_default="ACTIVE"),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("UPDATED_BY", sa.String(50)),
        sa.Column("UPDATED_DT", sa.DateTime),
    )

    op.create_table(
        "PM_NODE",
        sa.Column("NODE_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("PROJECT_ID", sa.Integer, sa.ForeignKey("PM_PROJECT.PROJECT_ID"), nullable=False),
        sa.Column("NODE_KEY", sa.String(100), nullable=False),
        sa.Column("NODE_NM", sa.String(200), nullable=False),
        sa.Column("NODE_TYPE", sa.String(50)),
        sa.Column("POS_X", sa.Float),
        sa.Column("POS_Y", sa.Float),
        sa.Column("DESCRIPTION", sa.String(1000)),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("PROJECT_ID", "NODE_KEY", name="UQ_PM_NODE_KEY"),
    )

    op.create_table(
        "PM_NODE_EDGE",
        sa.Column("EDGE_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("PROJECT_ID", sa.Integer, sa.ForeignKey("PM_PROJECT.PROJECT_ID"), nullable=False),
        sa.Column("SOURCE_NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID"), nullable=False),
        sa.Column("TARGET_NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID"), nullable=False),
        sa.Column("LABEL", sa.String(100)),
        sa.Column("CONDITION_EXPR", sa.String(500)),
    )

    op.create_table(
        "PM_PROMPT_VERSION",
        sa.Column("PROMPT_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID"), nullable=False),
        sa.Column("VERSION_NO", sa.String(20), nullable=False),
        sa.Column("SYSTEM_PROMPT", sa.Text),
        sa.Column("USER_PROMPT", sa.Text),
        sa.Column("MODEL_PROVIDER", sa.String(50), nullable=False),
        sa.Column("MODEL_NM", sa.String(100), nullable=False),
        sa.Column("TEMPERATURE", sa.Numeric(3, 2)),
        sa.Column("MAX_TOKENS", sa.Integer),
        sa.Column("TOP_P", sa.Numeric(3, 2)),
        sa.Column("EXTRA_PARAMS", sa.Text),
        sa.Column("IS_ACTIVE", sa.String(1), server_default="N"),
        sa.Column("CHANGE_SUMMARY", sa.String(500)),
        sa.Column("CHANGE_REASON", sa.String(1000)),
        sa.Column("PREV_PROMPT_ID", sa.Integer, sa.ForeignKey("PM_PROMPT_VERSION.PROMPT_ID")),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("NODE_ID", "VERSION_NO", name="UQ_PM_PROMPT_VERSION"),
    )

    op.create_table(
        "PM_PROMPT_VARIABLE",
        sa.Column("VAR_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("PROMPT_ID", sa.Integer, sa.ForeignKey("PM_PROMPT_VERSION.PROMPT_ID"), nullable=False),
        sa.Column("VAR_NAME", sa.String(100), nullable=False),
        sa.Column("VAR_TYPE", sa.String(50), server_default="STRING"),
        sa.Column("DESCRIPTION", sa.String(300)),
        sa.Column("DEFAULT_VALUE", sa.String(500)),
        sa.Column("IS_REQUIRED", sa.String(1), server_default="Y"),
    )

    op.create_table(
        "PM_TEST_DATASET",
        sa.Column("DATASET_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID"), nullable=False),
        sa.Column("DATASET_NM", sa.String(200), nullable=False),
        sa.Column("DESCRIPTION", sa.String(500)),
        sa.Column("IS_ACTIVE", sa.String(1), server_default="Y"),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "PM_TEST_CASE",
        sa.Column("CASE_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("DATASET_ID", sa.Integer, sa.ForeignKey("PM_TEST_DATASET.DATASET_ID"), nullable=False),
        sa.Column("CASE_NM", sa.String(200)),
        sa.Column("INPUT_DATA", sa.Text, nullable=False),
        sa.Column("EXPECTED_OUTPUT", sa.Text),
        sa.Column("EVAL_CRITERIA", sa.Text),
        sa.Column("CASE_TYPE", sa.String(50), server_default="NORMAL"),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "PM_TEST_RUN",
        sa.Column("RUN_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("RUN_TYPE", sa.String(20), nullable=False),
        sa.Column("NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID")),
        sa.Column("PROJECT_ID", sa.Integer, sa.ForeignKey("PM_PROJECT.PROJECT_ID")),
        sa.Column("PROMPT_ID", sa.Integer, sa.ForeignKey("PM_PROMPT_VERSION.PROMPT_ID")),
        sa.Column("DATASET_ID", sa.Integer, sa.ForeignKey("PM_TEST_DATASET.DATASET_ID")),
        sa.Column("STATUS", sa.String(20), server_default="PENDING"),
        sa.Column("TOTAL_CASES", sa.Integer, server_default="0"),
        sa.Column("PASSED_CASES", sa.Integer, server_default="0"),
        sa.Column("FAILED_CASES", sa.Integer, server_default="0"),
        sa.Column("AVG_LATENCY_MS", sa.Integer),
        sa.Column("TOTAL_TOKENS", sa.Integer),
        sa.Column("STARTED_DT", sa.DateTime),
        sa.Column("ENDED_DT", sa.DateTime),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "PM_TEST_RESULT",
        sa.Column("RESULT_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("RUN_ID", sa.Integer, sa.ForeignKey("PM_TEST_RUN.RUN_ID"), nullable=False),
        sa.Column("CASE_ID", sa.Integer, sa.ForeignKey("PM_TEST_CASE.CASE_ID")),
        sa.Column("ACTUAL_OUTPUT", sa.Text),
        sa.Column("IS_PASSED", sa.String(1)),
        sa.Column("EVAL_DETAIL", sa.Text),
        sa.Column("LATENCY_MS", sa.Integer),
        sa.Column("INPUT_TOKENS", sa.Integer),
        sa.Column("OUTPUT_TOKENS", sa.Integer),
        sa.Column("ERROR_MSG", sa.String(1000)),
        sa.Column("EXECUTED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "PM_RAGAS_RUN",
        sa.Column("RAGAS_RUN_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("NODE_ID", sa.Integer, sa.ForeignKey("PM_NODE.NODE_ID"), nullable=False),
        sa.Column("PROMPT_ID", sa.Integer, sa.ForeignKey("PM_PROMPT_VERSION.PROMPT_ID"), nullable=False),
        sa.Column("DATASET_ID", sa.Integer, sa.ForeignKey("PM_TEST_DATASET.DATASET_ID"), nullable=False),
        sa.Column("STATUS", sa.String(20), server_default="PENDING"),
        sa.Column("FAITHFULNESS", sa.Numeric(5, 4)),
        sa.Column("ANSWER_RELEVANCY", sa.Numeric(5, 4)),
        sa.Column("CONTEXT_PRECISION", sa.Numeric(5, 4)),
        sa.Column("CONTEXT_RECALL", sa.Numeric(5, 4)),
        sa.Column("ANSWER_CORRECTNESS", sa.Numeric(5, 4)),
        sa.Column("STARTED_DT", sa.DateTime),
        sa.Column("ENDED_DT", sa.DateTime),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "PM_AUDIT_LOG",
        sa.Column("LOG_ID", sa.Integer, sa.Identity(always=True), primary_key=True),
        sa.Column("TARGET_TABLE", sa.String(50), nullable=False),
        sa.Column("TARGET_ID", sa.Integer, nullable=False),
        sa.Column("ACTION", sa.String(20), nullable=False),
        sa.Column("BEFORE_VALUE", sa.Text),
        sa.Column("AFTER_VALUE", sa.Text),
        sa.Column("CREATED_BY", sa.String(50), nullable=False),
        sa.Column("CREATED_DT", sa.DateTime, server_default=sa.func.current_timestamp()),
    )

    op.create_index("IDX_PM_NODE_PROJECT", "PM_NODE", ["PROJECT_ID"])
    op.create_index("IDX_PM_EDGE_PROJECT", "PM_NODE_EDGE", ["PROJECT_ID"])
    op.create_index("IDX_PM_PROMPT_NODE", "PM_PROMPT_VERSION", ["NODE_ID"])
    op.create_index("IDX_PM_PROMPT_ACTIVE", "PM_PROMPT_VERSION", ["NODE_ID", "IS_ACTIVE"])
    op.create_index("IDX_PM_AUDIT_TARGET", "PM_AUDIT_LOG", ["TARGET_TABLE", "TARGET_ID"])
    op.create_index("IDX_PM_AUDIT_DT", "PM_AUDIT_LOG", ["CREATED_DT"])


def downgrade() -> None:
    for tbl in [
        "PM_AUDIT_LOG", "PM_RAGAS_RUN", "PM_TEST_RESULT", "PM_TEST_RUN",
        "PM_TEST_CASE", "PM_TEST_DATASET", "PM_PROMPT_VARIABLE", "PM_PROMPT_VERSION",
        "PM_NODE_EDGE", "PM_NODE", "PM_PROJECT",
    ]:
        op.drop_table(tbl)
