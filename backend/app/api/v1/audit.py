from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.audit import AuditLog
from app.models.node_prompt_ver import NodePromptVer
from app.schemas.audit import AuditLogOut, AuditLogPage

router = APIRouter(tags=["audit"])


@router.get("/audit-logs", response_model=AuditLogPage)
def list_audit_logs(
    target_table: str | None = Query(None),
    user: str | None = Query(None),
    action: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    conditions = []
    if target_table:
        conditions.append(AuditLog.target_table == target_table)
    if user:
        conditions.append(AuditLog.created_by == user)
    if action:
        conditions.append(AuditLog.action == action)
    if date_from:
        conditions.append(AuditLog.created_dt >= date_from)
    if date_to:
        conditions.append(AuditLog.created_dt <= date_to)

    where = and_(*conditions) if conditions else None

    total_stmt = select(func.count()).select_from(AuditLog)
    if where is not None:
        total_stmt = total_stmt.where(where)
    total = db.execute(total_stmt).scalar_one()

    stmt = select(AuditLog).order_by(AuditLog.created_dt.desc())
    if where is not None:
        stmt = stmt.where(where)
    stmt = stmt.offset((page - 1) * size).limit(size)
    rows = db.execute(stmt).scalars().all()

    return AuditLogPage(
        total=total,
        page=page,
        size=size,
        items=[AuditLogOut.model_validate(r) for r in rows],
    )


@router.get("/nodes/{node_nm}/audit-logs", response_model=list[AuditLogOut])
def node_audit_logs(
    node_nm: str,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[AuditLogOut]:
    """PM_NODE_PROMPT_VER events whose target_id is one of this node's prompt versions."""
    prompt_ids = (
        db.execute(select(NodePromptVer.prompt_id).where(NodePromptVer.node_nm == node_nm))
        .scalars()
        .all()
    )
    if not prompt_ids:
        return []
    where = and_(
        AuditLog.target_table == "PM_NODE_PROMPT_VER",
        AuditLog.target_id.in_(prompt_ids),
    )
    stmt = (
        select(AuditLog)
        .where(where)
        .order_by(AuditLog.created_dt.desc())
        .limit(limit)
    )
    rows = db.execute(stmt).scalars().all()
    return [AuditLogOut.model_validate(r) for r in rows]
