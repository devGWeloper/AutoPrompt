from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.core.ws import manager
from app.models.node_prompt_ver import NodePromptVer
from app.models.ragas import RagasResult, RagasRun
from app.schemas.ragas import RagasResultOut, RagasRunDetail, RagasRunSummary
from app.services import audit as audit_service
from app.services import ragas_service

router = APIRouter(tags=["ragas"])
ws_router = APIRouter(tags=["ragas"])


def _version_map(db: Session, prompt_ids: list[int | None]) -> dict[int, str]:
    """{prompt_id: version_no} for A/B run labelling (one batched query)."""
    ids = {p for p in prompt_ids if p}
    if not ids:
        return {}
    rows = db.execute(
        select(NodePromptVer.prompt_id, NodePromptVer.version_no).where(NodePromptVer.prompt_id.in_(ids))
    ).all()
    return {pid: vno for pid, vno in rows}


@router.get("/ragas-runs", response_model=list[RagasRunSummary])
def list_all_ragas_runs(db: Session = Depends(get_db)) -> list[RagasRunSummary]:
    rows = (
        db.execute(select(RagasRun).order_by(RagasRun.ragas_run_id.desc())).scalars().all()
    )
    vmap = _version_map(db, [r.prompt_id for r in rows])
    out: list[RagasRunSummary] = []
    for r in rows:
        s = RagasRunSummary.model_validate(r)
        s.version_no = vmap.get(r.prompt_id) if r.prompt_id else None
        out.append(s)
    return out


@router.delete("/ragas-runs/{ragas_run_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_ragas_run(ragas_run_id: int, db: Session = Depends(get_db)) -> None:
    run = db.get(RagasRun, ragas_run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="ragas run not found")
    for r in db.execute(
        select(RagasResult).where(RagasResult.ragas_run_id == ragas_run_id)
    ).scalars():
        db.delete(r)
    db.flush()  # children before parent (FK order)
    db.delete(run)
    audit_service.write_audit(
        db, target_table="PM_RAGAS_RUN", target_id=ragas_run_id, action="DELETE",
        before={"ragas_run_id": ragas_run_id}, after=None, created_by=SYSTEM_USER,
    )
    db.commit()


@router.get("/ragas-runs/{ragas_run_id}", response_model=RagasRunDetail)
def get_ragas_run(ragas_run_id: int, db: Session = Depends(get_db)) -> RagasRunDetail:
    run = db.get(RagasRun, ragas_run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="ragas run not found")
    rows = (
        db.execute(
            select(RagasResult)
            .where(RagasResult.ragas_run_id == ragas_run_id)
            .order_by(RagasResult.ragas_result_id.asc())
        )
        .scalars()
        .all()
    )
    detail = RagasRunDetail.model_validate(run)
    detail.results = [RagasResultOut.model_validate(r) for r in rows]
    if run.prompt_id:
        pv = db.get(NodePromptVer, run.prompt_id)
        detail.version_no = pv.version_no if pv else None
    return detail


@ws_router.websocket("/ws/ragas-runs/{ragas_run_id}")
async def ragas_run_ws(websocket: WebSocket, ragas_run_id: int) -> None:
    key = ragas_service.ws_key(ragas_run_id)
    await manager.connect(key, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(key, websocket)
    except Exception:  # noqa: BLE001 - ensure cleanup on any socket error
        manager.disconnect(key, websocket)
