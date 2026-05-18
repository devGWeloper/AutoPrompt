from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.core.ws import manager
from app.schemas.test_run import FlowRunRequest, TestRunOut
from app.services import flow_service

router = APIRouter(tags=["flow"])
ws_router = APIRouter(tags=["flow"])


@router.post("/projects/{project_id}/flow/run", response_model=TestRunOut)
async def run_flow(
    project_id: int,
    payload: FlowRunRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TestRunOut:
    run = flow_service.create_flow_run(db, project_id=project_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(run)
    out = TestRunOut.model_validate(run)
    background.add_task(
        flow_service.execute_flow_run,
        run_id=run.run_id,
        project_id=project_id,
        variables=payload.variables,
    )
    return out


@ws_router.websocket("/ws/flow-runs/{run_id}")
async def flow_run_ws(websocket: WebSocket, run_id: int) -> None:
    await manager.connect(run_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(run_id, websocket)
    except Exception:  # noqa: BLE001 - ensure cleanup on any socket error
        manager.disconnect(run_id, websocket)
