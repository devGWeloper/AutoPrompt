from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.chat_ver import ChatVerMas
from app.models.node_mas import NodeMas
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


def get_node(db: Session, node_mas_id: int) -> NodeMas:
    node = db.get(NodeMas, node_mas_id)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    return node


def _require_prompt_node(node: NodeMas) -> None:
    if (node.prompt_edit_enable_yn or "N").upper() != "Y":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="node has no editable prompt (PROMPT_EDIT_ENABLE_YN != 'Y')",
        )


def suggest_next_version(db: Session, node_mas_id: int) -> str:
    latest = (
        db.execute(
            select(NodePromptVer)
            .where(NodePromptVer.node_mas_id == node_mas_id)
            .order_by(NodePromptVer.created_dt.desc(), NodePromptVer.prompt_id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if latest is None:
        return "1.0.0"
    return _bump_patch(latest.version_no)


def list_versions(db: Session, node_mas_id: int) -> list[NodePromptVer]:
    rows = (
        db.execute(
            select(NodePromptVer)
            .where(NodePromptVer.node_mas_id == node_mas_id)
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


def _parse_extra(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def to_detail(version: NodePromptVer) -> PromptVersionDetail:
    return PromptVersionDetail(
        prompt_id=version.prompt_id,
        node_mas_id=version.node_mas_id,
        node_nm=version.node_nm,
        version_no=version.version_no,
        is_active=version.is_active,
        model_nm=version.model_nm,
        temperature=version.temperature,
        max_tokens=version.max_tokens,
        top_p=version.top_p,
        extra_params=_parse_extra(version.extra_params),
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
        node_mas_id=version.node_mas_id,
        node_nm=version.node_nm,
        prompt_id=version.prompt_id,
        version_no=version.version_no,
        system_prompt=version.system_prompt,
        user_prompt=version.user_prompt,
        model_nm=version.model_nm,
    )


def active_prompts_for_flow(db: Session) -> dict[str, ActivePromptOut]:
    """All active prompts of the current flow, keyed by NODE_NM (inspection/compat)."""
    from app.services import flow_service

    chat = flow_service.get_current_chat(db)
    nodes = (
        db.execute(select(NodeMas).where(NodeMas.chat_ver_id == chat.id)).scalars().all()
    )
    node_ids = [n.id for n in nodes]
    if not node_ids:
        return {}
    actives = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_mas_id.in_(node_ids), NodePromptVer.is_active == "Y"
            )
        )
        .scalars()
        .all()
    )
    result: dict[str, ActivePromptOut] = {}
    for p in actives:
        result[p.node_nm] = _to_active(p)
    return result


def active_prompt_for_node_nm(db: Session, node_nm: str) -> ActivePromptOut:
    from app.services import flow_service

    chat = flow_service.get_current_chat(db)
    node = (
        db.execute(
            select(NodeMas).where(NodeMas.chat_ver_id == chat.id, NodeMas.node_nm == node_nm)
        )
        .scalars()
        .first()
    )
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    active = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_mas_id == node.id, NodePromptVer.is_active == "Y"
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
    node_mas_id: int,
    payload: PromptVersionCreate,
    created_by: str,
) -> NodePromptVer:
    node = get_node(db, node_mas_id)
    _require_prompt_node(node)

    version_no = payload.version_no or suggest_next_version(db, node_mas_id)

    dup = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_mas_id == node_mas_id,
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

    # Model is decided at the flow level (NODE_MAS.MODEL_NM is NULL/unused); snapshot
    # the current flow main model for traceability/display.
    chat = db.get(ChatVerMas, node.chat_ver_id)
    main_model = chat.main_model_nm if chat else None

    new_version = NodePromptVer(
        node_mas_id=node_mas_id,
        node_nm=node.node_nm,
        version_no=version_no,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
        model_nm=payload.model_nm or main_model,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        top_p=payload.top_p,
        extra_params=json.dumps(payload.extra_params, ensure_ascii=False)
        if payload.extra_params is not None
        else None,
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
            "node_mas_id": node_mas_id,
            "node_nm": node.node_nm,
            "version_no": version_no,
            "change_summary": payload.change_summary,
            "change_reason": payload.change_reason,
            "system_prompt": payload.system_prompt,
            "user_prompt": payload.user_prompt,
        },
        created_by=created_by,
    )
    return new_version


def activate_version(db: Session, *, prompt_id: int, actor: str) -> NodePromptVer:
    """Activate a node prompt version.

    1. flip IS_ACTIVE on PM_NODE_PROMPT_VER (one active per node)
    2. mirror the prompt text into NODE_MAS.PROMPT (+ UPDATE_DATE/UPDATE_USER) so
       the operational project picks it up
    3. cut a new whole-flow version snapshot (PM_FLOW_VER + manifest)
    """
    from app.services import flow_service

    target = get_version(db, prompt_id)
    node = get_node(db, target.node_mas_id)

    current_active = (
        db.execute(
            select(NodePromptVer).where(
                NodePromptVer.node_mas_id == target.node_mas_id,
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

    # (2) reflect into the operational NODE_MAS row. NODE_MAS has a single PROMPT
    # column, so only the SYSTEM_PROMPT is mirrored (it maps to the agent's
    # session_system_prompt); USER_PROMPT stays in PM. (Per-node model is not
    # editable — MODEL_EDIT_ENABLE_YN is always 'N' — so only PROMPT is mirrored.)
    node.prompt = target.system_prompt
    node.update_date = now
    node.update_user = actor
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

    # (3) bump the whole-flow version (a node prompt change == new flow version).
    flow_service.cut_flow_version(
        db,
        actor=actor,
        summary=f"activate {target.node_nm} v{target.version_no}",
        reason=None,
    )
    return target


def update_version_prompt(
    db: Session,
    *,
    prompt_id: int,
    system_prompt: str,
    user_prompt: str,
    change_summary: str | None,
    change_reason: str | None,
    actor: str,
) -> NodePromptVer:
    """Edit an existing version's prompt text in place. Only **inactive** versions
    may be edited (the active version is locked — change it via a new version)."""
    target = get_version(db, prompt_id)
    if target.is_active == "Y":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="active version is locked; create a new version instead",
        )
    before = {"system_prompt": target.system_prompt, "user_prompt": target.user_prompt}
    target.system_prompt = system_prompt
    target.user_prompt = user_prompt
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
        after={"system_prompt": system_prompt, "user_prompt": user_prompt},
        created_by=actor,
    )
    return target
