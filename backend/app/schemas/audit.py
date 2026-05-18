from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    log_id: int
    target_table: str
    target_id: int
    action: str
    before_value: str | None = None
    after_value: str | None = None
    created_by: str
    created_dt: datetime


class AuditLogPage(BaseModel):
    total: int
    page: int
    size: int
    items: list[AuditLogOut]
