from __future__ import annotations

import json
import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.prompt import PromptVersion
from app.models.prompt_variable import PromptVariable
from app.schemas.prompt import (
    PromptVariableInOut,
    PromptVersionCreate,
    PromptVersionDetail,
)
from app.services import audit as audit_service
from app.services.variable_parser import extract_variables

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _bump_patch(version_no: str) -> str:
    m = _VERSION_RE.match(version_no)
    if not m:
        return f"{version_no}.1"
    major, minor, patch = (int(x) for x in m.groups())
    return f"{major}.{minor}.{patch + 1}"


def suggest_next_version(db: Session, node_id: int) -> str:
    latest = (
        db.execute(
            select(PromptVersion)
            .where(PromptVersion.node_id == node_id)
            .order_by(PromptVersion.created_dt.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if latest is None:
        return "1.0.0"
    return _bump_patch(latest.version_no)


def list_versions(db: Session, node_id: int) -> list[PromptVersion]:
    rows = (
        db.execute(
            select(PromptVersion)
            .where(PromptVersion.node_id == node_id)
            .order_by(PromptVersion.created_dt.desc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def get_version(db: Session, prompt_id: int) -> PromptVersion:
    obj = db.get(PromptVersion, prompt_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="prompt version not found")
    return obj


def get_variables(db: Session, prompt_id: int) -> list[PromptVariable]:
    rows = (
        db.execute(
            select(PromptVariable)
            .where(PromptVariable.prompt_id == prompt_id)
            .order_by(PromptVariable.var_id.asc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def _parse_extra(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def to_detail(version: PromptVersion, variables: list[PromptVariable]) -> PromptVersionDetail:
    return PromptVersionDetail(
        prompt_id=version.prompt_id,
        node_id=version.node_id,
        version_no=version.version_no,
        is_active=version.is_active,
        model_provider=version.model_provider,
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
        system_prompt=version.system_prompt,
        user_prompt=version.user_prompt,
        variables=[PromptVariableInOut.model_validate(v) for v in variables],
    )


def create_version(
    db: Session,
    *,
    node_id: int,
    payload: PromptVersionCreate,
    created_by: str,
) -> PromptVersion:
    version_no = payload.version_no or suggest_next_version(db, node_id)

    dup = (
        db.execute(
            select(PromptVersion).where(
                PromptVersion.node_id == node_id, PromptVersion.version_no == version_no
            )
        )
        .scalars()
        .first()
    )
    if dup is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"version {version_no} already exists for this node"
        )

    new_version = PromptVersion(
        node_id=node_id,
        version_no=version_no,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
        model_provider=payload.model_provider,
        model_nm=payload.model_nm,
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

    var_names = extract_variables(payload.system_prompt, payload.user_prompt)
    for name in var_names:
        db.add(PromptVariable(prompt_id=new_version.prompt_id, var_name=name))
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_PROMPT_VERSION",
        target_id=new_version.prompt_id,
        action="CREATE",
        before=None,
        after={
            "prompt_id": new_version.prompt_id,
            "node_id": node_id,
            "version_no": version_no,
            "change_summary": payload.change_summary,
        },
        created_by=created_by,
    )
    return new_version


def activate_version(db: Session, *, prompt_id: int, actor: str) -> PromptVersion:
    target = get_version(db, prompt_id)

    current_active = (
        db.execute(
            select(PromptVersion).where(
                PromptVersion.node_id == target.node_id, PromptVersion.is_active == "Y"
            )
        )
        .scalars()
        .first()
    )

    if current_active and current_active.prompt_id == target.prompt_id:
        return target

    before_snapshot = {
        "active_prompt_id": current_active.prompt_id if current_active else None,
        "active_version_no": current_active.version_no if current_active else None,
    }

    if current_active:
        current_active.is_active = "N"
    target.is_active = "Y"
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_PROMPT_VERSION",
        target_id=target.prompt_id,
        action="ACTIVATE",
        before=before_snapshot,
        after={"active_prompt_id": target.prompt_id, "active_version_no": target.version_no},
        created_by=actor,
    )
    return target


def replace_variables(
    db: Session,
    *,
    prompt_id: int,
    variables: list[PromptVariableInOut],
    actor: str,
) -> list[PromptVariable]:
    target = get_version(db, prompt_id)
    existing = get_variables(db, prompt_id)
    before_snapshot = [
        {
            "var_name": v.var_name,
            "var_type": v.var_type,
            "description": v.description,
            "default_value": v.default_value,
            "is_required": v.is_required,
        }
        for v in existing
    ]
    for row in existing:
        db.delete(row)
    db.flush()
    new_rows: list[PromptVariable] = []
    for spec in variables:
        row = PromptVariable(
            prompt_id=prompt_id,
            var_name=spec.var_name,
            var_type=spec.var_type,
            description=spec.description,
            default_value=spec.default_value,
            is_required=spec.is_required,
        )
        db.add(row)
        new_rows.append(row)
    db.flush()

    audit_service.write_audit(
        db,
        target_table="PM_PROMPT_VARIABLE",
        target_id=prompt_id,
        action="UPDATE",
        before=before_snapshot,
        after=[v.model_dump() for v in variables],
        created_by=actor,
    )
    _ = target  # silence linter; ensures we validated existence above
    return new_rows
