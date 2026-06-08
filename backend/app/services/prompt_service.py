from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
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


def node_exists(db: Session, node_nm: str) -> bool:
    """True if NODE_NM already has at least one version (i.e. the node exists)."""
    found = (
        db.execute(
            select(NodePromptVer.prompt_id).where(NodePromptVer.node_nm == node_nm).limit(1)
        )
        .scalars()
        .first()
    )
    return found is not None


def delete_version(db: Session, *, prompt_id: int, actor: str) -> None:
    """Delete one prompt version. FK references are cleared before the row is
    removed: sibling ``PREV_PROMPT_ID`` pointers and ``PM_RAGAS_RUN.PROMPT_ID``."""
    from app.models.ragas import RagasRun

    target = get_version(db, prompt_id)

    before = {
        "node_nm": target.node_nm,
        "version_no": target.version_no,
        "model_nm": target.model_nm,
        "change_summary": target.change_summary,
        "change_reason": target.change_reason,
        "system_prompt": target.system_prompt,
        "user_prompt": target.user_prompt,
    }

    # Clear FK references so the delete doesn't violate integrity.
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.prev_prompt_id == prompt_id)
        .values(prev_prompt_id=None)
    )
    db.execute(update(RagasRun).where(RagasRun.prompt_id == prompt_id).values(prompt_id=None))

    db.delete(target)
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE_PROMPT_VER",
        target_id=prompt_id,
        action="DELETE",
        before=before,
        after=None,
        created_by=actor,
    )


def delete_node(db: Session, *, node_nm: str, actor: str) -> int:
    """Delete a whole node: every version of NODE_NM (active included). FK
    references (RagasRun.prompt_id, internal prev links) are cleared first.
    Returns the number of versions deleted."""
    from app.models.ragas import RagasRun

    rows = list_versions(db, node_nm)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    ids = [r.prompt_id for r in rows]

    db.execute(update(RagasRun).where(RagasRun.prompt_id.in_(ids)).values(prompt_id=None))
    db.execute(
        update(NodePromptVer)
        .where(NodePromptVer.prev_prompt_id.in_(ids))
        .values(prev_prompt_id=None)
    )
    db.execute(delete(NodePromptVer).where(NodePromptVer.node_nm == node_nm))
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_NODE_PROMPT_VER",
        target_id=ids[0],
        action="DELETE",
        before={
            "node_nm": node_nm,
            "deleted_version_count": len(ids),
            "version_nos": [r.version_no for r in rows],
        },
        after=None,
        created_by=actor,
    )
    return len(ids)
