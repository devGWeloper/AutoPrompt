from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Identity, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RagasRun(Base):
    __tablename__ = "PM_RAGAS_RUN"

    ragas_run_id: Mapped[int] = mapped_column("RAGAS_RUN_ID", Integer, Identity(always=True), primary_key=True)
    # FLOW-scoped run: the whole flow (CHAT_VER_MAS) is evaluated.
    chat_ver_id: Mapped[int | None] = mapped_column("CHAT_VER_ID", Integer, ForeignKey("CHAT_VER_MAS.ID"))
    # A/B version comparison: which node's prompt version this run evaluated (its
    # SYSTEM_PROMPT is swapped into the flow). NULL for a plain single run.
    # AB_GROUP_ID links the two runs of one comparison (= the A run's id).
    node_mas_id: Mapped[int | None] = mapped_column("NODE_MAS_ID", Integer, ForeignKey("NODE_MAS.ID"))
    prompt_id: Mapped[int | None] = mapped_column("PROMPT_ID", Integer, ForeignKey("PM_NODE_PROMPT_VER.PROMPT_ID"))
    ab_group_id: Mapped[int | None] = mapped_column("AB_GROUP_ID", Integer)
    dataset_id: Mapped[int] = mapped_column("DATASET_ID", Integer, ForeignKey("PM_TEST_DATASET.DATASET_ID"), nullable=False)
    status: Mapped[str] = mapped_column("STATUS", String(20), default="PENDING", server_default="PENDING")
    faithfulness: Mapped[Decimal | None] = mapped_column("FAITHFULNESS", Numeric(5, 4))
    answer_relevancy: Mapped[Decimal | None] = mapped_column("ANSWER_RELEVANCY", Numeric(5, 4))
    context_precision: Mapped[Decimal | None] = mapped_column("CONTEXT_PRECISION", Numeric(5, 4))
    context_recall: Mapped[Decimal | None] = mapped_column("CONTEXT_RECALL", Numeric(5, 4))
    answer_correctness: Mapped[Decimal | None] = mapped_column("ANSWER_CORRECTNESS", Numeric(5, 4))
    # Phase 4: judge model + selected metrics + which engine actually ran.
    judge_provider: Mapped[str | None] = mapped_column("JUDGE_PROVIDER", String(50))
    judge_model: Mapped[str | None] = mapped_column("JUDGE_MODEL", String(100))
    metrics: Mapped[str | None] = mapped_column("METRICS", Text)
    engine: Mapped[str | None] = mapped_column("ENGINE", String(20))
    error_msg: Mapped[str | None] = mapped_column("ERROR_MSG", Text)
    started_dt: Mapped[datetime | None] = mapped_column("STARTED_DT", DateTime)
    ended_dt: Mapped[datetime | None] = mapped_column("ENDED_DT", DateTime)
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )


class RagasResult(Base):
    """Per-case metric breakdown for a RAGAS run (spec F-52)."""

    __tablename__ = "PM_RAGAS_RESULT"

    ragas_result_id: Mapped[int] = mapped_column(
        "RAGAS_RESULT_ID", Integer, Identity(always=True), primary_key=True
    )
    ragas_run_id: Mapped[int] = mapped_column(
        "RAGAS_RUN_ID", Integer, ForeignKey("PM_RAGAS_RUN.RAGAS_RUN_ID"), nullable=False
    )
    case_id: Mapped[int | None] = mapped_column(
        "CASE_ID", Integer, ForeignKey("PM_TEST_CASE.CASE_ID")
    )
    question: Mapped[str | None] = mapped_column("QUESTION", Text)
    answer: Mapped[str | None] = mapped_column("ANSWER", Text)
    contexts: Mapped[str | None] = mapped_column("CONTEXTS", Text)
    ground_truth: Mapped[str | None] = mapped_column("GROUND_TRUTH", Text)
    faithfulness: Mapped[Decimal | None] = mapped_column("FAITHFULNESS", Numeric(5, 4))
    answer_relevancy: Mapped[Decimal | None] = mapped_column("ANSWER_RELEVANCY", Numeric(5, 4))
    context_precision: Mapped[Decimal | None] = mapped_column("CONTEXT_PRECISION", Numeric(5, 4))
    context_recall: Mapped[Decimal | None] = mapped_column("CONTEXT_RECALL", Numeric(5, 4))
    answer_correctness: Mapped[Decimal | None] = mapped_column("ANSWER_CORRECTNESS", Numeric(5, 4))
    error_msg: Mapped[str | None] = mapped_column("ERROR_MSG", Text)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
