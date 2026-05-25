from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DatasetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    dataset_id: int
    node_mas_id: int | None = None
    scope: str = "NODE"
    dataset_nm: str
    description: str | None = None
    is_active: str
    created_by: str
    created_dt: datetime


class DatasetDetail(DatasetSummary):
    case_count: int = 0


class DatasetCreate(BaseModel):
    dataset_nm: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)


class DatasetUpdate(BaseModel):
    dataset_nm: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    is_active: str | None = Field(default=None, pattern="^[YN]$")


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    case_id: int
    dataset_id: int
    input_data: str
    expected_output: str | None = None
    eval_criteria: str | None = None
    case_type: str
    created_by: str
    created_dt: datetime


class CaseCreate(BaseModel):
    input_data: str = Field(..., min_length=1)
    expected_output: str | None = None
    eval_criteria: str | None = None
    case_type: str = Field(default="NORMAL", max_length=50)


class CaseUpdate(BaseModel):
    input_data: str | None = Field(default=None, min_length=1)
    expected_output: str | None = None
    eval_criteria: str | None = None
    case_type: str | None = Field(default=None, max_length=50)


class CsvUploadResult(BaseModel):
    created: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
