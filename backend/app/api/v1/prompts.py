from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.models.node import Node
from app.schemas.prompt import (
    PromptDiffOut,
    PromptVariableInOut,
    PromptVariablesUpdate,
    PromptVersionCreate,
    PromptVersionDetail,
    PromptVersionSummary,
)
from app.services import prompt_service
from app.services.diff_service import diff_text

router = APIRouter(tags=["prompts"])


@router.get("/nodes/{node_id}/prompts", response_model=list[PromptVersionSummary])
def list_prompts(
    node_id: int,
    db: Session = Depends(get_db),
) -> list[PromptVersionSummary]:
    if db.get(Node, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
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
    if db.get(Node, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")

    version = prompt_service.create_version(
        db, node_id=node_id, payload=payload, created_by=SYSTEM_USER
    )
    if payload.activate_after_save:
        prompt_service.activate_version(db, prompt_id=version.prompt_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version, prompt_service.get_variables(db, version.prompt_id))


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
def get_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
) -> PromptVersionDetail:
    version = prompt_service.get_version(db, prompt_id)
    return prompt_service.to_detail(version, prompt_service.get_variables(db, prompt_id))


@router.put("/prompts/{prompt_id}/activate", response_model=PromptVersionDetail)
def activate(
    prompt_id: int,
    db: Session = Depends(get_db),
) -> PromptVersionDetail:
    version = prompt_service.activate_version(db, prompt_id=prompt_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(version)
    return prompt_service.to_detail(version, prompt_service.get_variables(db, prompt_id))


@router.get("/prompts/{prompt_id}/variables", response_model=list[PromptVariableInOut])
def get_variables(
    prompt_id: int,
    db: Session = Depends(get_db),
) -> list[PromptVariableInOut]:
    prompt_service.get_version(db, prompt_id)
    return [
        PromptVariableInOut.model_validate(v) for v in prompt_service.get_variables(db, prompt_id)
    ]


@router.put("/prompts/{prompt_id}/variables", response_model=list[PromptVariableInOut])
def replace_variables(
    prompt_id: int,
    payload: PromptVariablesUpdate,
    db: Session = Depends(get_db),
) -> list[PromptVariableInOut]:
    new_rows = prompt_service.replace_variables(
        db, prompt_id=prompt_id, variables=payload.variables, actor=SYSTEM_USER
    )
    db.commit()
    return [PromptVariableInOut.model_validate(v) for v in new_rows]
