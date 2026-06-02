from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FlowNodeOut(BaseModel):
    """One node of the current flow + its active prompt version.

    A node is anything that has at least one PM_NODE_PROMPT_VER row. The active
    row's version_no + model_nm are surfaced so the home screen can show them.
    """

    model_config = ConfigDict(from_attributes=True)
    node_nm: str
    active_prompt_id: int | None = None
    active_version_no: str | None = None
    active_model_nm: str | None = None


class FlowCurrentOut(BaseModel):
    nodes: list[FlowNodeOut] = Field(default_factory=list)


class FlowRagasRequest(BaseModel):
    dataset_id: int
    metrics: list[str] = Field(default_factory=list)


class FlowRagasAbRequest(BaseModel):
    """Compare two prompt versions of one node on the same dataset."""

    dataset_id: int
    node_nm: str
    prompt_id_a: int
    prompt_id_b: int
    metrics: list[str] = Field(default_factory=list)


class FlowRagasAbOut(BaseModel):
    ragas_run_a_id: int
    ragas_run_b_id: int
