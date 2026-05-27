from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FlowNodeOut(BaseModel):
    """A node of the current flow (from NODE_MAS) + its active prompt version."""

    model_config = ConfigDict(from_attributes=True)
    node_mas_id: int
    node_nm: str
    node_desc: str | None = None
    model_nm: str | None = None
    prompt_edit_enable_yn: str = "N"
    model_edit_enable_yn: str = "N"
    main_model_edit_enable_yn: str = "N"
    has_prompt: bool = False  # PROMPT_EDIT_ENABLE_YN == 'Y' (LLM/prompt node)
    active_prompt_id: int | None = None
    active_version_no: str | None = None


class FlowCurrentOut(BaseModel):
    """The current flow: mermaid graph + main model + nodes."""

    chat_ver_id: int
    flow_version_no: str | None = None
    main_model_nm: str | None = None
    main_model_editable: bool = False
    graph_struct: str | None = None
    nodes: list[FlowNodeOut] = Field(default_factory=list)


class MainModelUpdate(BaseModel):
    main_model_nm: str = Field(..., min_length=1, max_length=100)


class FlowVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    flow_ver_id: int
    chat_ver_id: int
    flow_version_no: str
    is_active: str
    main_model_nm: str | None = None
    change_summary: str | None = None
    created_by: str
    created_dt: datetime


class FlowVersionNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    node_mas_id: int
    node_nm: str
    prompt_id: int | None = None
    version_no: str | None = None


class FlowVersionDetail(FlowVersionSummary):
    graph_struct: str | None = None
    change_reason: str | None = None
    nodes: list[FlowVersionNodeOut] = Field(default_factory=list)


class FlowTestRequest(BaseModel):
    """Inputs forwarded to the operational project's single run-flow endpoint."""

    inputs: dict[str, str] = Field(default_factory=dict)


class FlowBatchRequest(BaseModel):
    dataset_id: int


class FlowABRequest(BaseModel):
    dataset_id: int
    flow_ver_a: int
    flow_ver_b: int


class FlowABRunOut(BaseModel):
    run_a_id: int
    run_b_id: int


class FlowRagasRequest(BaseModel):
    dataset_id: int
    metrics: list[str] = Field(default_factory=list)
