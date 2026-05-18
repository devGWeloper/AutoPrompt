from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def _to_json(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump_json()
    return json.dumps(value, default=str, ensure_ascii=False)


def write_audit(
    db: Session,
    *,
    target_table: str,
    target_id: int,
    action: str,
    before: Any | None,
    after: Any | None,
    created_by: str,
) -> AuditLog:
    log = AuditLog(
        target_table=target_table,
        target_id=target_id,
        action=action,
        before_value=_to_json(before),
        after_value=_to_json(after),
        created_by=created_by,
    )
    db.add(log)
    db.flush()
    return log
