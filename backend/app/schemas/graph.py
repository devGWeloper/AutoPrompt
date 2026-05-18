from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    project_id: int
    project_nm: str
    description: str | None = None
    status: str
    created_by: str
    created_dt: datetime


class ActivePromptSummary(BaseModel):
    prompt_id: int
    version_no: str


class ActiveModelSummary(BaseModel):
    model_provider: str
    model_nm: str


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    node_id: int
    project_id: int
    node_key: str
    node_nm: str
    node_type: str | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    description: str | None = None
    active_prompt: ActivePromptSummary | None = None
    active_model: ActiveModelSummary | None = None


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    edge_id: int
    project_id: int
    source_node_id: int
    target_node_id: int
    label: str | None = None
    condition_expr: str | None = None


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]


class NodePositionUpdate(BaseModel):
    node_id: int
    pos_x: float
    pos_y: float


class GraphLayoutUpdate(BaseModel):
    positions: list[NodePositionUpdate] = Field(default_factory=list)


class NodeCreate(BaseModel):
    node_key: str
    node_nm: str
    node_type: str | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    description: str | None = None


class NodeUpdate(BaseModel):
    node_nm: str | None = None
    node_type: str | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    description: str | None = None
