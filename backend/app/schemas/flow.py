from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FlowNodeOut(BaseModel):
    """One node of the current flow + its latest prompt version.

    A node is anything that has at least one PM_NODE_PROMPT_VER row. There is no
    persistent active version (IS_ACTIVE is set only during a test run), so the
    latest version_no + model_nm are surfaced for the node list.
    """

    model_config = ConfigDict(from_attributes=True)
    node_nm: str
    latest_prompt_id: int | None = None
    latest_version_no: str | None = None
    latest_model_nm: str | None = None


class FlowCurrentOut(BaseModel):
    nodes: list[FlowNodeOut] = Field(default_factory=list)


class FlowRagasRequest(BaseModel):
    dataset_id: int
    metrics: list[str] = Field(default_factory=list)
    # Optional: target a specific node version (activated only while the run uses
    # it). The UI requires it; left optional here for back-compat.
    node_nm: str | None = None
    prompt_id: int | None = None


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
