from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    prompt_id: int
    node_nm: str
    version_no: str
    is_active: str
    model_nm: str | None = None
    change_summary: str | None = None
    created_by: str
    created_dt: datetime


class PromptVersionDetail(PromptVersionSummary):
    system_prompt: str | None = None
    user_prompt: str | None = None
    change_reason: str | None = None
    prev_prompt_id: int | None = None
    updated_dt: datetime | None = None


class ActivePromptOut(BaseModel):
    """A node's active prompt (system + user + model), keyed by NODE_NM."""

    model_config = ConfigDict(from_attributes=True)
    node_nm: str
    prompt_id: int
    version_no: str
    model_nm: str | None = None
    system_prompt: str | None = None
    user_prompt: str | None = None


class PromptVersionCreate(BaseModel):
    system_prompt: str = ""
    user_prompt: str = ""
    model_nm: str | None = None
    version_no: str | None = None
    change_summary: str = Field(..., min_length=1, max_length=500)
    change_reason: str = Field(..., min_length=1, max_length=1000)
    prev_prompt_id: int | None = None
    activate_after_save: bool = False


class PromptVersionEdit(BaseModel):
    system_prompt: str = ""
    user_prompt: str = ""
    model_nm: str | None = None
    change_summary: str | None = Field(default=None, max_length=500)
    change_reason: str | None = Field(default=None, max_length=1000)


class PromptDiffLine(BaseModel):
    tag: str  # "equal" | "insert" | "delete" | "replace"
    a_line: str | None = None
    b_line: str | None = None


class PromptDiffSection(BaseModel):
    added: int
    removed: int
    unified: str  # difflib unified diff text
    lines: list[PromptDiffLine]


class PromptDiffOut(BaseModel):
    v1_prompt_id: int
    v2_prompt_id: int
    system_prompt: PromptDiffSection
    user_prompt: PromptDiffSection
