from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.services.ragas.base import ALL_METRICS


class RagasRunRequest(BaseModel):
    prompt_id: int
    dataset_id: int
    metrics: list[str] = Field(default_factory=lambda: list(ALL_METRICS))
    judge_provider: str | None = None
    judge_model: str | None = None


class RagasResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ragas_result_id: int
    ragas_run_id: int
    case_id: int | None = None
    question: str | None = None
    answer: str | None = None
    contexts: str | None = None
    ground_truth: str | None = None
    faithfulness: Decimal | None = None
    answer_relevancy: Decimal | None = None
    context_precision: Decimal | None = None
    context_recall: Decimal | None = None
    answer_correctness: Decimal | None = None
    error_msg: str | None = None


class RagasRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ragas_run_id: int
    node_id: int
    prompt_id: int
    dataset_id: int
    status: str
    engine: str | None = None
    metrics: str | None = None
    judge_provider: str | None = None
    judge_model: str | None = None
    faithfulness: Decimal | None = None
    answer_relevancy: Decimal | None = None
    context_precision: Decimal | None = None
    context_recall: Decimal | None = None
    answer_correctness: Decimal | None = None
    error_msg: str | None = None
    started_dt: datetime | None = None
    ended_dt: datetime | None = None
    created_by: str
    created_dt: datetime


class RagasRunDetail(RagasRunOut):
    results: list[RagasResultOut] = Field(default_factory=list)


class RagasRunSummary(BaseModel):
    """Compact row for the history list / metric-trend line chart (F-52/F-53)."""

    model_config = ConfigDict(from_attributes=True)
    ragas_run_id: int
    prompt_id: int
    status: str
    engine: str | None = None
    faithfulness: Decimal | None = None
    answer_relevancy: Decimal | None = None
    context_precision: Decimal | None = None
    context_recall: Decimal | None = None
    answer_correctness: Decimal | None = None
    created_dt: datetime
