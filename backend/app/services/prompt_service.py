from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.node_prompt_ver import NodePromptVer
from app.schemas.prompt import (
    ActivePromptOut,
    PromptVersionCreate,
    PromptVersionDetail,
)
from app.services import audit as audit_service

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _bump_patch(version_no: str) -> str:
    m = _VERSION_RE.match(version_no)
    if not m:
        return f"{version_no}.1"
    major, minor, patch = (int(x) for x in m.groups())
    return f"{major}.{minor}.{patch + 1}"


def suggest_next_version(db: Session, node_nm: str) -> str:
    latest = (
        db.execute(
            select(NodePromptVer)
            .where(NodePromptVer.node_nm == node_nm)
            .order_by(NodePromptVer.created_dt.desc(), NodePromptVer.prompt_id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if latest is None:
        return "1.0.0"
    return _bump_patch(latest.version_no)


def list_versions(db: Session, node_nm: str) -> list[NodePromptVer]:
    rows = (
        db.execute(
            select(NodePromptVer)
            .where(NodePromptVer.node_nm == node_nm)
            .order_by(NodePromptVer.created_dt.desc(), NodePromptVer.prompt_id.desc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def get_version(db: Session, prompt_id: int) -> NodePromptVer:
    obj = db.get(NodePromptVer, prompt_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="prompt version not found")
    return obj


def to_detail(version: NodePromptVer) -> PromptVersionDetail:
    return PromptVersionDetail(
        prompt_id=version.prompt_id,
        node_nm=version.node_nm,
        version_no=version.version_no,
        is_active=version.is_active,
        model_nm=version.model_nm,
        change_summary=version.change_summary,
        change_reason=version.change_reason,
        prev_prompt_id=version.prev_prompt_id,
        created_by=version.created_by,
        created_dt=version.created_dt,
        updated_dt=version.updated_dt,
        system_prompt=version.system_prompt,
        user_prompt=version.user_prompt,
    )


def _to_active(version: NodePromptVer) -> ActivePromptOut:
    return ActivePromptOut(
        node_nm=version.node_nm,
        prompt_id=version.prompt_id,
        version_no=version.version_no,
        model_nm=version.model_nm,
        system_prompt=version.system_prompt,
        user_prompt=version.user_prompt,
    )


def active_prompts_for_flow(db: Session) -> dict[str, ActivePromptOut]:
    """All active prompts keyed by NODE_NM."""
    actives = (
        db.execute(select(NodePromptVer).where(NodePromptVer.is_active == "Y"))
        .scalars()
        .all()
    )
    return {p.node_nm: _to_active(p) for p in actives}


def active_prompt_for_node_nm(db: Session, node_nm: str) -> ActivePromptOut:
    active = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_nm == node_nm, NodePromptVer.is_active == "Y"
            )
        )
        .scalars()
        .first()
    )
    if active is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no active prompt for this node")
    return _to_active(active)


def create_version(
    db: Session,
    *,
    node_nm: str,
    payload: PromptVersionCreate,
    created_by: str,
) -> NodePromptVer:
    """Create a new version for NODE_NM. The first version of a fresh node_nm
    bootstraps the node — PM doesn't pre-register nodes elsewhere."""
    version_no = payload.version_no or suggest_next_version(db, node_nm)

    dup = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_nm == node_nm,
                NodePromptVer.version_no == version_no,
            )
        )
        .scalars()
        .first()
    )
    if dup is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"version {version_no} already exists for this node",
        )

    new_version = NodePromptVer(
        node_nm=node_nm,
        version_no=version_no,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
        model_nm=payload.model_nm,
        is_active="N",
        change_summary=payload.change_summary,
        change_reason=payload.change_reason,
        prev_prompt_id=payload.prev_prompt_id,
        created_by=created_by,
    )
    db.add(new_version)
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE_PROMPT_VER",
        target_id=new_version.prompt_id,
        action="CREATE",
        before=None,
        after={
            "prompt_id": new_version.prompt_id,
            "node_nm": node_nm,
            "version_no": version_no,
            "model_nm": payload.model_nm,
            "change_summary": payload.change_summary,
            "change_reason": payload.change_reason,
            "system_prompt": payload.system_prompt,
            "user_prompt": payload.user_prompt,
        },
        created_by=created_by,
    )
    return new_version


def activate_version(db: Session, *, prompt_id: int, actor: str) -> NodePromptVer:
    """Activate a node prompt version: flip IS_ACTIVE on PM_NODE_PROMPT_VER
    (one active per NODE_NM). The external model reads the active row directly."""
    target = get_version(db, prompt_id)

    current_active = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_nm == target.node_nm,
                NodePromptVer.is_active == "Y",
            )
        )
        .scalars()
        .first()
    )

    already_active = bool(current_active and current_active.prompt_id == target.prompt_id)
    before_snapshot = {
        "active_prompt_id": current_active.prompt_id if current_active else None,
        "active_version_no": current_active.version_no if current_active else None,
    }

    now = datetime.now(timezone.utc)
    if current_active and not already_active:
        current_active.is_active = "N"
    target.is_active = "Y"
    target.updated_dt = now
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE_PROMPT_VER",
        target_id=target.prompt_id,
        action="ACTIVATE",
        before=before_snapshot,
        after={"active_prompt_id": target.prompt_id, "active_version_no": target.version_no},
        created_by=actor,
    )
    return target


def update_version_prompt(
    db: Session,
    *,
    prompt_id: int,
    system_prompt: str,
    user_prompt: str,
    model_nm: str | None,
    change_summary: str | None,
    change_reason: str | None,
    actor: str,
) -> NodePromptVer:
    """Edit an existing version's prompt text + model in place. Active version
    edits are allowed — the external model will read the new content on its
    next refresh."""
    target = get_version(db, prompt_id)
    before = {
        "system_prompt": target.system_prompt,
        "user_prompt": target.user_prompt,
        "model_nm": target.model_nm,
    }
    target.system_prompt = system_prompt
    target.user_prompt = user_prompt
    target.model_nm = model_nm
    if change_summary:
        target.change_summary = change_summary
    if change_reason:
        target.change_reason = change_reason
    target.updated_dt = datetime.now(timezone.utc)
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE_PROMPT_VER",
        target_id=prompt_id,
        action="UPDATE",
        before=before,
        after={"system_prompt": system_prompt, "user_prompt": user_prompt, "model_nm": model_nm},
        created_by=actor,
    )
    return target
