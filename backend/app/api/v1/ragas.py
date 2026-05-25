from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.core.ws import manager
from app.models.node_mas import NodeMas
from app.models.ragas import RagasResult, RagasRun
from app.schemas.ragas import (
    RagasResultOut,
    RagasRunDetail,
    RagasRunOut,
    RagasRunRequest,
    RagasRunSummary,
)
from app.services import audit as audit_service
from app.services import ragas_service

router = APIRouter(tags=["ragas"])
ws_router = APIRouter(tags=["ragas"])


@router.get("/ragas-runs", response_model=list[RagasRunSummary])
def list_all_ragas_runs(db: Session = Depends(get_db)) -> list[RagasRunSummary]:
    rows = (
        db.execute(select(RagasRun).order_by(RagasRun.ragas_run_id.desc())).scalars().all()
    )
    return [RagasRunSummary.model_validate(r) for r in rows]


@router.delete("/ragas-runs/{ragas_run_id}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.post("/nodes/{node_id}/ragas/run", response_model=RagasRunOut)
async def run_ragas(
    node_id: int,
    payload: RagasRunRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RagasRunOut:
    run = ragas_service.create_ragas_run(
        db, node_mas_id=node_id, payload=payload, actor=SYSTEM_USER
    )
    db.commit()
    db.refresh(run)
    out = RagasRunOut.model_validate(run)
    background.add_task(
        ragas_service.execute_ragas_run,
        ragas_run_id=run.ragas_run_id,
        prompt_id=payload.prompt_id,
        dataset_id=payload.dataset_id,
    )
    return out


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
    return detail


@router.get("/nodes/{node_id}/ragas-runs", response_model=list[RagasRunSummary])
def list_node_ragas_runs(
    node_id: int, db: Session = Depends(get_db)
) -> list[RagasRunSummary]:
    if db.get(NodeMas, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    rows = (
        db.execute(
            select(RagasRun)
            .where(RagasRun.node_mas_id == node_id)
            .order_by(RagasRun.ragas_run_id.asc())
        )
        .scalars()
        .all()
    )
    return [RagasRunSummary.model_validate(r) for r in rows]


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
