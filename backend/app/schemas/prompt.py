from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PromptVariableInOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    var_name: str
    var_type: str = "STRING"
    description: str | None = None
    default_value: str | None = None
    is_required: str = "Y"


class PromptVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    prompt_id: int
    node_id: int
    version_no: str
    is_active: str
    model_provider: str
    model_nm: str
    change_summary: str | None = None
    created_by: str
    created_dt: datetime


class PromptVersionDetail(PromptVersionSummary):
    system_prompt: str | None = None
    user_prompt: str | None = None
    temperature: Decimal | None = None
    max_tokens: int | None = None
    top_p: Decimal | None = None
    extra_params: dict | None = None
    change_reason: str | None = None
    prev_prompt_id: int | None = None
    variables: list[PromptVariableInOut] = Field(default_factory=list)


class PromptVersionCreate(BaseModel):
    system_prompt: str = ""
    user_prompt: str = ""
    version_no: str | None = None
    model_provider: str = Field(..., min_length=1, max_length=50)
    model_nm: str = Field(..., min_length=1, max_length=100)
    temperature: Decimal | None = None
    max_tokens: int | None = None
    top_p: Decimal | None = None
    extra_params: dict | None = None
    change_summary: str = Field(..., min_length=1, max_length=500)
    change_reason: str = Field(..., min_length=1, max_length=1000)
    prev_prompt_id: int | None = None
    activate_after_save: bool = False


class PromptVariablesUpdate(BaseModel):
    variables: list[PromptVariableInOut]


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
