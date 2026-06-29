from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

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
    prompt_id: int | None = None
    ab_group_id: int | None = None
    node_nm: str | None = None  # resolved from prompt_id by the router (not a column)
    version_no: str | None = None  # resolved from prompt_id by the router (not a column)
    dataset_id: int
    status: str
    engine: str | None = None  # 'direct' marks a raw external-API call (no scoring)
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
    """Compact row for the history list / metric-trend line chart.

    ``error_msg`` surfaces the failure reason in the records list so a FAILED run is
    visible (not silently dropped).
    """

    model_config = ConfigDict(from_attributes=True)
    ragas_run_id: int
    prompt_id: int | None = None
    ab_group_id: int | None = None
    node_nm: str | None = None  # resolved from prompt_id by the router (not a column)
    version_no: str | None = None  # resolved from prompt_id by the router (not a column)
    status: str
    engine: str | None = None  # 'direct' marks a raw external-API call (no scoring)
    faithfulness: Decimal | None = None
    answer_relevancy: Decimal | None = None
    context_precision: Decimal | None = None
    context_recall: Decimal | None = None
    answer_correctness: Decimal | None = None
    error_msg: str | None = None
    created_dt: datetime
