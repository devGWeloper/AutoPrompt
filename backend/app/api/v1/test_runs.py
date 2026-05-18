from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.core.ws import manager
from app.models.test_run import TestResult, TestRun
from app.schemas.test_run import (
    ABRunOut,
    ABTestRequest,
    BatchTestRequest,
    SingleTestRequest,
    TestResultOut,
    TestRunDetail,
    TestRunOut,
)
from app.services import test_service

router = APIRouter(tags=["test-runs"])
ws_router = APIRouter(tags=["test-runs"])


@router.post("/nodes/{node_id}/test/run", response_model=TestRunOut)
async def run_single_test(
    node_id: int,
    payload: SingleTestRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TestRunOut:
    run = test_service.create_single_run(
        db, node_id=node_id, payload=payload, actor=SYSTEM_USER
    )
    db.commit()
    db.refresh(run)
    out = TestRunOut.model_validate(run)
    background.add_task(
        test_service.execute_single_run,
        run_id=run.run_id,
        prompt_id=payload.prompt_id,
        variables=payload.variables,
    )
    return out


@router.post("/nodes/{node_id}/test/batch", response_model=TestRunOut)
async def run_batch_test(
    node_id: int,
    payload: BatchTestRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TestRunOut:
    run = test_service.create_batch_run(
        db,
        node_id=node_id,
        prompt_id=payload.prompt_id,
        dataset_id=payload.dataset_id,
        run_type="BATCH",
        actor=SYSTEM_USER,
    )
    db.commit()
    db.refresh(run)
    out = TestRunOut.model_validate(run)
    background.add_task(
        test_service.execute_batch_run,
        run_id=run.run_id,
        prompt_id=payload.prompt_id,
        dataset_id=payload.dataset_id,
    )
    return out


@router.post("/nodes/{node_id}/test/ab", response_model=ABRunOut)
async def run_ab_test(
    node_id: int,
    payload: ABTestRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ABRunOut:
    run_a = test_service.create_batch_run(
        db,
        node_id=node_id,
        prompt_id=payload.prompt_id_a,
        dataset_id=payload.dataset_id,
        run_type="AB",
        actor=SYSTEM_USER,
    )
    run_b = test_service.create_batch_run(
        db,
        node_id=node_id,
        prompt_id=payload.prompt_id_b,
        dataset_id=payload.dataset_id,
        run_type="AB",
        actor=SYSTEM_USER,
    )
    db.commit()
    db.refresh(run_a)
    db.refresh(run_b)
    a_id, b_id = run_a.run_id, run_b.run_id
    background.add_task(
        test_service.execute_batch_run,
        run_id=a_id,
        prompt_id=payload.prompt_id_a,
        dataset_id=payload.dataset_id,
    )
    background.add_task(
        test_service.execute_batch_run,
        run_id=b_id,
        prompt_id=payload.prompt_id_b,
        dataset_id=payload.dataset_id,
    )
    return ABRunOut(run_a_id=a_id, run_b_id=b_id)


@router.get("/test-runs/{run_id}", response_model=TestRunDetail)
def get_test_run(run_id: int, db: Session = Depends(get_db)) -> TestRunDetail:
    run = db.get(TestRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="test run not found")
    results = (
        db.execute(
            select(TestResult)
            .where(TestResult.run_id == run_id)
            .order_by(TestResult.result_id.asc())
        )
        .scalars()
        .all()
    )
    detail = TestRunDetail.model_validate(run)
    detail.results = [TestResultOut.model_validate(r) for r in results]
    return detail


@router.get("/test-runs/{run_id}/results", response_model=list[TestResultOut])
def get_test_run_results(
    run_id: int, db: Session = Depends(get_db)
) -> list[TestResultOut]:
    if db.get(TestRun, run_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="test run not found")
    rows = (
        db.execute(
            select(TestResult)
            .where(TestResult.run_id == run_id)
            .order_by(TestResult.result_id.asc())
        )
        .scalars()
        .all()
    )
    return [TestResultOut.model_validate(r) for r in rows]


@ws_router.websocket("/ws/test-runs/{run_id}")
async def test_run_ws(websocket: WebSocket, run_id: int) -> None:
    await manager.connect(run_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(run_id, websocket)
    except Exception:  # noqa: BLE001 - ensure cleanup on any socket error
        manager.disconnect(run_id, websocket)
