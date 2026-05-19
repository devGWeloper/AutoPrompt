"""drop PM_TEST_CASE.CASE_NM (cases identified by CASE_ID)

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-19 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("PM_TEST_CASE", "CASE_NM")


def downgrade() -> None:
    op.add_column("PM_TEST_CASE", sa.Column("CASE_NM", sa.String(200)))
