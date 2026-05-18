from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Identity, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TestRun(Base):
    __tablename__ = "PM_TEST_RUN"

    run_id: Mapped[int] = mapped_column("RUN_ID", Integer, Identity(always=True), primary_key=True)
    run_type: Mapped[str] = mapped_column("RUN_TYPE", String(20), nullable=False)
    node_id: Mapped[int | None] = mapped_column("NODE_ID", Integer, ForeignKey("PM_NODE.NODE_ID"))
    project_id: Mapped[int | None] = mapped_column("PROJECT_ID", Integer, ForeignKey("PM_PROJECT.PROJECT_ID"))
    prompt_id: Mapped[int | None] = mapped_column("PROMPT_ID", Integer, ForeignKey("PM_PROMPT_VERSION.PROMPT_ID"))
    dataset_id: Mapped[int | None] = mapped_column("DATASET_ID", Integer, ForeignKey("PM_TEST_DATASET.DATASET_ID"))
    status: Mapped[str] = mapped_column("STATUS", String(20), default="PENDING", server_default="PENDING")
    total_cases: Mapped[int] = mapped_column("TOTAL_CASES", Integer, default=0, server_default="0")
    passed_cases: Mapped[int] = mapped_column("PASSED_CASES", Integer, default=0, server_default="0")
    failed_cases: Mapped[int] = mapped_column("FAILED_CASES", Integer, default=0, server_default="0")
    avg_latency_ms: Mapped[int | None] = mapped_column("AVG_LATENCY_MS", Integer)
    total_tokens: Mapped[int | None] = mapped_column("TOTAL_TOKENS", Integer)
    started_dt: Mapped[datetime | None] = mapped_column("STARTED_DT", DateTime)
    ended_dt: Mapped[datetime | None] = mapped_column("ENDED_DT", DateTime)
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )


class TestResult(Base):
    __tablename__ = "PM_TEST_RESULT"

    result_id: Mapped[int] = mapped_column("RESULT_ID", Integer, Identity(always=True), primary_key=True)
    run_id: Mapped[int] = mapped_column("RUN_ID", Integer, ForeignKey("PM_TEST_RUN.RUN_ID"), nullable=False)
    case_id: Mapped[int | None] = mapped_column("CASE_ID", Integer, ForeignKey("PM_TEST_CASE.CASE_ID"))
    actual_output: Mapped[str | None] = mapped_column("ACTUAL_OUTPUT", Text)
    is_passed: Mapped[str | None] = mapped_column("IS_PASSED", String(1))
    eval_detail: Mapped[str | None] = mapped_column("EVAL_DETAIL", Text)
    latency_ms: Mapped[int | None] = mapped_column("LATENCY_MS", Integer)
    input_tokens: Mapped[int | None] = mapped_column("INPUT_TOKENS", Integer)
    output_tokens: Mapped[int | None] = mapped_column("OUTPUT_TOKENS", Integer)
    error_msg: Mapped[str | None] = mapped_column("ERROR_MSG", String(1000))
    executed_dt: Mapped[datetime] = mapped_column(
        "EXECUTED_DT", DateTime, server_default=func.current_timestamp()
    )
