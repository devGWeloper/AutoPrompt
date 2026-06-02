from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Identity, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TestDataset(Base):
    """Flow-level RAGAS dataset (PM-owned, no node anchor)."""

    __tablename__ = "PM_TEST_DATASET"

    dataset_id: Mapped[int] = mapped_column(
        "DATASET_ID", Integer, Identity(always=True), primary_key=True
    )
    dataset_nm: Mapped[str] = mapped_column("DATASET_NM", String(200), nullable=False)
    description: Mapped[str | None] = mapped_column("DESCRIPTION", String(500))
    is_active: Mapped[str] = mapped_column("IS_ACTIVE", String(1), default="Y", server_default="Y")
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )


class TestCase(Base):
    __tablename__ = "PM_TEST_CASE"

    case_id: Mapped[int] = mapped_column("CASE_ID", Integer, Identity(always=True), primary_key=True)
    dataset_id: Mapped[int] = mapped_column("DATASET_ID", Integer, ForeignKey("PM_TEST_DATASET.DATASET_ID"), nullable=False)
    input_data: Mapped[str] = mapped_column("INPUT_DATA", Text, nullable=False)
    expected_output: Mapped[str | None] = mapped_column("EXPECTED_OUTPUT", Text)
    eval_criteria: Mapped[str | None] = mapped_column("EVAL_CRITERIA", Text)
    case_type: Mapped[str] = mapped_column("CASE_TYPE", String(50), default="NORMAL", server_default="NORMAL")
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
