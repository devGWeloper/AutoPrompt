from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FlowNodeOut(BaseModel):
    """A node of the current flow (from NODE_MAS) + its active prompt version.

    Drives the node list used to navigate into per-node prompt management.
    """

    model_config = ConfigDict(from_attributes=True)
    node_mas_id: int
    node_nm: str
    node_desc: str | None = None
    has_prompt: bool = False  # PROMPT_EDIT_ENABLE_YN == 'Y' (LLM/prompt node)
    active_prompt_id: int | None = None
    active_version_no: str | None = None


class FlowCurrentOut(BaseModel):
    """The current flow (CHAT_VER_MAS) + its nodes."""

    chat_ver_id: int
    nodes: list[FlowNodeOut] = Field(default_factory=list)


class FlowRagasRequest(BaseModel):
    dataset_id: int
    metrics: list[str] = Field(default_factory=list)
