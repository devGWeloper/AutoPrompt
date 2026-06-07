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
from app.services import flow_service
from app.services import ragas_service

router = APIRouter(tags=["ragas"])
ws_router = APIRouter(tags=["ragas"])


def _resolve_prompts(db: Session, prompt_ids: list[int | None]) -> dict[int, tuple[str, str]]:
    """{prompt_id: (node_nm, version_no)} for A/B labelling (one batched query)."""
    ids = {p for p in prompt_ids if p}
    if not ids:
        return {}
    rows = db.execute(
        select(NodePromptVer.prompt_id, NodePromptVer.node_nm, NodePromptVer.version_no)
        .where(NodePromptVer.prompt_id.in_(ids))
    ).all()
    return {pid: (nm, vno) for pid, nm, vno in rows}


@router.get("/ragas-runs", response_model=list[RagasRunSummary])
def list_all_ragas_runs(db: Session = Depends(get_db)) -> list[RagasRunSummary]:
    rows = (
        db.execute(select(RagasRun).order_by(RagasRun.ragas_run_id.desc())).scalars().all()
    )
    rmap = _resolve_prompts(db, [r.prompt_id for r in rows])
    out: list[RagasRunSummary] = []
    for r in rows:
        s = RagasRunSummary.model_validate(r)
        resolved = rmap.get(r.prompt_id) if r.prompt_id else None
        if resolved:
            s.node_nm, s.version_no = resolved
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


@router.post("/ragas-runs/{ragas_run_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
def cancel_ragas_run(ragas_run_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    """Ask a running RAGAS run to stop. The background loop halts at the next case
    and marks the run CANCELLED, keeping any partial answers/scores."""
    run = db.get(RagasRun, ragas_run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="ragas run not found")
    if run.status in ("DONE", "FAILED", "CANCELLED"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"run already {run.status}")
    # Persist the cancel signal in the shared DB (status=CANCELLING) so the run
    # loop sees it even if it runs on a different worker, plus the in-process flag
    # for an immediate same-worker stop. The loop flips it to CANCELLED when it halts.
    run.status = "CANCELLING"
    db.commit()
    flow_service.request_cancel(ragas_run_id)
    return {"status": "cancelling", "ragas_run_id": str(ragas_run_id)}


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
        if pv is not None:
            detail.node_nm = pv.node_nm
            detail.version_no = pv.version_no
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
