from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.schemas.prompt import (
    ActivePromptOut,
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
    """All active prompts of the current flow, keyed by NODE_NM (inspection/compat).

    At runtime the operational project reads NODE_MAS.PROMPT directly (activation
    writes the SYSTEM_PROMPT there), so this is not the primary delivery path.
    """
    return prompt_service.active_prompts_for_flow(db)


@router.get("/nodes/by-name/{node_nm}/active-prompt", response_model=ActivePromptOut)
def get_active_prompt_by_name(node_nm: str, db: Session = Depends(get_db)) -> ActivePromptOut:
    return prompt_service.active_prompt_for_node_nm(db, node_nm)


@router.get("/nodes/{node_id}/prompts", response_model=list[PromptVersionSummary])
def list_prompts(node_id: int, db: Session = Depends(get_db)) -> list[PromptVersionSummary]:
    prompt_service.get_node(db, node_id)  # 404 if missing
    rows = prompt_service.list_versions(db, node_id)
    return [PromptVersionSummary.model_validate(r) for r in rows]


@router.post(
    "/nodes/{node_id}/prompts",
    response_model=PromptVersionDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_prompt(
    node_id: int,
    payload: PromptVersionCreate,
    db: Session = Depends(get_db),
) -> PromptVersionDetail:
    version = prompt_service.create_version(
        db, node_mas_id=node_id, payload=payload, created_by=SYSTEM_USER
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
    """Edit an inactive version's prompt text in place (active version is locked)."""
    version = prompt_service.update_version_prompt(
        db,
        prompt_id=prompt_id,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
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
