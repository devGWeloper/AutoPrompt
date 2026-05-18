from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Identity, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RagasRun(Base):
    __tablename__ = "PM_RAGAS_RUN"

    ragas_run_id: Mapped[int] = mapped_column("RAGAS_RUN_ID", Integer, Identity(always=True), primary_key=True)
    node_id: Mapped[int] = mapped_column("NODE_ID", Integer, ForeignKey("PM_NODE.NODE_ID"), nullable=False)
    prompt_id: Mapped[int] = mapped_column("PROMPT_ID", Integer, ForeignKey("PM_PROMPT_VERSION.PROMPT_ID"), nullable=False)
    dataset_id: Mapped[int] = mapped_column("DATASET_ID", Integer, ForeignKey("PM_TEST_DATASET.DATASET_ID"), nullable=False)
    status: Mapped[str] = mapped_column("STATUS", String(20), default="PENDING", server_default="PENDING")
    faithfulness: Mapped[Decimal | None] = mapped_column("FAITHFULNESS", Numeric(5, 4))
    answer_relevancy: Mapped[Decimal | None] = mapped_column("ANSWER_RELEVANCY", Numeric(5, 4))
    context_precision: Mapped[Decimal | None] = mapped_column("CONTEXT_PRECISION", Numeric(5, 4))
    context_recall: Mapped[Decimal | None] = mapped_column("CONTEXT_RECALL", Numeric(5, 4))
    answer_correctness: Mapped[Decimal | None] = mapped_column("ANSWER_CORRECTNESS", Numeric(5, 4))
    started_dt: Mapped[datetime | None] = mapped_column("STARTED_DT", DateTime)
    ended_dt: Mapped[datetime | None] = mapped_column("ENDED_DT", DateTime)
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
