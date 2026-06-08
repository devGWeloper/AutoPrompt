from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.schemas.prompt import (
    ActivePromptOut,
    NodeCreate,
    PromptDiffOut,
    PromptVersionCreate,
    PromptVersionDetail,
    PromptVersionEdit,
    PromptVersionSummary,
)
from app.services import prompt_service
from app.services.diff_service import diff_text

router = APIRouter(tags=["prompts"])


@router.get("/active-prompts", response_model=dict[str, ActivePromptOut])
def list_active_prompts(db: Session = Depends(get_db)) -> dict[str, ActivePromptOut]:
    """All active prompts (system + user + model), keyed by NODE_NM. The external
    model reads PM_NODE_PROMPT_VER's active row directly; this endpoint is for
    inspection from the PM UI."""
    return prompt_service.active_prompts_for_flow(db)


@router.get("/nodes/{node_nm}/active-prompt", response_model=ActivePromptOut)
def get_active_prompt_by_name(node_nm: str, db: Session = Depends(get_db)) -> ActivePromptOut:
    return prompt_service.active_prompt_for_node_nm(db, node_nm)


@router.post("/nodes", response_model=PromptVersionDetail, status_code=status.HTTP_201_CREATED)
def create_node(payload: NodeCreate, db: Session = Depends(get_db)) -> PromptVersionDetail:
    """Bootstrap a new node: create its first prompt version (and optionally
    activate it). A node is any NODE_NM with at least one version."""
    if prompt_service.node_exists(db, payload.node_nm):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 존재하는 노드입니다")
    version = prompt_service.create_version(
        db, node_nm=payload.node_nm, payload=payload, created_by=SYSTEM_USER
    )
    if payload.activate_after_save:
        prompt_service.activate_version(db, prompt_id=version.prompt_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version)


@router.delete("/nodes/{node_nm}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node(node_nm: str, db: Session = Depends(get_db)) -> None:
    prompt_service.delete_node(db, node_nm=node_nm, actor=SYSTEM_USER)
    db.commit()


@router.get("/nodes/{node_nm}/prompts", response_model=list[PromptVersionSummary])
def list_prompts(node_nm: str, db: Session = Depends(get_db)) -> list[PromptVersionSummary]:
    rows = prompt_service.list_versions(db, node_nm)
    return [PromptVersionSummary.model_validate(r) for r in rows]


@router.post(
    "/nodes/{node_nm}/prompts",
    response_model=PromptVersionDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_prompt(
    node_nm: str,
    payload: PromptVersionCreate,
    db: Session = Depends(get_db),
) -> PromptVersionDetail:
    version = prompt_service.create_version(
        db, node_nm=node_nm, payload=payload, created_by=SYSTEM_USER
    )
    if payload.activate_after_save:
        prompt_service.activate_version(db, prompt_id=version.prompt_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version)


@router.get("/prompts/diff", response_model=PromptDiffOut)
def diff_prompts(
    v1: int = Query(..., description="prompt_id v1"),
    v2: int = Query(..., description="prompt_id v2"),
    db: Session = Depends(get_db),
) -> PromptDiffOut:
    a = prompt_service.get_version(db, v1)
    b = prompt_service.get_version(db, v2)
    return PromptDiffOut(
        v1_prompt_id=v1,
        v2_prompt_id=v2,
        system_prompt=diff_text(a.system_prompt, b.system_prompt),
        user_prompt=diff_text(a.user_prompt, b.user_prompt),
    )


@router.get("/prompts/{prompt_id}", response_model=PromptVersionDetail)
def get_prompt(prompt_id: int, db: Session = Depends(get_db)) -> PromptVersionDetail:
    version = prompt_service.get_version(db, prompt_id)
    return prompt_service.to_detail(version)


@router.put("/prompts/{prompt_id}", response_model=PromptVersionDetail)
def edit_prompt(
    prompt_id: int,
    payload: PromptVersionEdit,
    db: Session = Depends(get_db),
) -> PromptVersionDetail:
    """Edit an inactive version's prompt text + model in place (active version is locked)."""
    version = prompt_service.update_version_prompt(
        db,
        prompt_id=prompt_id,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
        model_nm=payload.model_nm,
        change_summary=payload.change_summary,
        change_reason=payload.change_reason,
        actor=SYSTEM_USER,
    )
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version)


@router.put("/prompts/{prompt_id}/activate", response_model=PromptVersionDetail)
def activate(prompt_id: int, db: Session = Depends(get_db)) -> PromptVersionDetail:
    version = prompt_service.activate_version(db, prompt_id=prompt_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version)


@router.delete("/prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(prompt_id: int, db: Session = Depends(get_db)) -> None:
    """Delete one prompt version (active version is locked — activate another first)."""
    prompt_service.delete_version(db, prompt_id=prompt_id, actor=SYSTEM_USER)
    db.commit()
