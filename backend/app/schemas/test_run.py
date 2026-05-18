from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SingleTestRequest(BaseModel):
    prompt_id: int
    variables: dict[str, str] = Field(default_factory=dict)


class BatchTestRequest(BaseModel):
    prompt_id: int
    dataset_id: int


class ABTestRequest(BaseModel):
    prompt_id_a: int
    prompt_id_b: int
    dataset_id: int


class ABRunOut(BaseModel):
    run_a_id: int
    run_b_id: int


class FlowRunRequest(BaseModel):
    variables: dict[str, str] = Field(default_factory=dict)


class TestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    run_id: int
    run_type: str
    node_id: int | None = None
    prompt_id: int | None = None
    dataset_id: int | None = None
    status: str
    total_cases: int
    passed_cases: int
    failed_cases: int
    avg_latency_ms: int | None = None
    total_tokens: int | None = None
    started_dt: datetime | None = None
    ended_dt: datetime | None = None
    created_by: str
    created_dt: datetime


class TestResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    result_id: int
    run_id: int
    case_id: int | None = None
    actual_output: str | None = None
    is_passed: str | None = None
    eval_detail: str | None = None
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error_msg: str | None = None


class TestRunDetail(TestRunOut):
    results: list[TestResultOut] = Field(default_factory=list)
