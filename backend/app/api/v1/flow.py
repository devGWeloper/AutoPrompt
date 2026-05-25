from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.core.ws import manager
from app.schemas.dataset import DatasetCreate, DatasetDetail, DatasetSummary
from app.schemas.flow import (
    FlowABRequest,
    FlowABRunOut,
    FlowBatchRequest,
    FlowCurrentOut,
    FlowRagasRequest,
    FlowTestRequest,
    FlowVersionDetail,
    FlowVersionSummary,
    MainModelUpdate,
)
from app.schemas.ragas import RagasRunOut
from app.schemas.test_run import TestRunOut
from app.services import dataset_service, flow_service

router = APIRouter(tags=["flow"])
ws_router = APIRouter(tags=["flow"])


@router.get("/flow/current", response_model=FlowCurrentOut)
def get_current_flow(db: Session = Depends(get_db)) -> FlowCurrentOut:
    """The single current flow: mermaid graph (GRAPH_STRUCT) + main model + nodes."""
    return flow_service.get_current_flow(db)


@router.get("/flow/models", response_model=list[str])
def list_models(db: Session = Depends(get_db)) -> list[str]:
    """Available model names (MODEL_MAS.GAIA_MODEL_NM) for the main-model selector."""
    return flow_service.list_models(db)


@router.put("/flow/main-model", response_model=FlowCurrentOut)
def set_main_model(payload: MainModelUpdate, db: Session = Depends(get_db)) -> FlowCurrentOut:
    """Change the flow main model → writes CHAT_VER_MAS.MAIN_MODEL_NM + cuts a new flow version."""
    flow_service.set_main_model(db, main_model_nm=payload.main_model_nm, actor=SYSTEM_USER)
    db.commit()
    return flow_service.get_current_flow(db)


@router.get("/flow/versions", response_model=list[FlowVersionSummary])
def list_flow_versions(db: Session = Depends(get_db)) -> list[FlowVersionSummary]:
    return [FlowVersionSummary.model_validate(v) for v in flow_service.list_flow_versions(db)]


@router.get("/flow/versions/{flow_ver_id}", response_model=FlowVersionDetail)
def get_flow_version(flow_ver_id: int, db: Session = Depends(get_db)) -> FlowVersionDetail:
    return flow_service.get_flow_version(db, flow_ver_id)


@router.delete("/flow/versions/{flow_ver_id}", status_code=204)
def delete_flow_version(flow_ver_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a flow version (active version cannot be deleted)."""
    flow_service.delete_flow_version(db, flow_ver_id=flow_ver_id, actor=SYSTEM_USER)
    db.commit()


@router.post("/flow/test/run", response_model=TestRunOut)
async def run_flow_test(
    payload: FlowTestRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TestRunOut:
    """Full/flow test: drive the whole flow via the external run-flow endpoint."""
    run = flow_service.create_flow_test_run(db, actor=SYSTEM_USER)
    db.commit()
    db.refresh(run)
    out = TestRunOut.model_validate(run)
    background.add_task(
        flow_service.execute_flow_test_run, run_id=run.run_id, inputs=payload.inputs
    )
    return out


@router.get("/flow/datasets", response_model=list[DatasetSummary])
def list_flow_datasets(db: Session = Depends(get_db)) -> list[DatasetSummary]:
    return [DatasetSummary.model_validate(d) for d in dataset_service.list_flow_datasets(db)]


@router.post("/flow/datasets", response_model=DatasetDetail, status_code=201)
def create_flow_dataset(payload: DatasetCreate, db: Session = Depends(get_db)) -> DatasetDetail:
    ds = dataset_service.create_flow_dataset(db, payload=payload, created_by=SYSTEM_USER)
    db.commit()
    db.refresh(ds)
    return DatasetDetail(
        **DatasetSummary.model_validate(ds).model_dump(),
        case_count=dataset_service.case_count(db, ds.dataset_id),
    )


@router.post("/flow/test/batch", response_model=TestRunOut)
async def run_flow_batch(
    payload: FlowBatchRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> TestRunOut:
    run = flow_service.create_flow_batch_run(db, dataset_id=payload.dataset_id, actor=SYSTEM_USER)
    db.commit()
    db.refresh(run)
    out = TestRunOut.model_validate(run)
    background.add_task(flow_service.execute_flow_dataset_run, run_id=run.run_id, dataset_id=payload.dataset_id)
    return out


@router.post("/flow/test/ab", response_model=FlowABRunOut)
async def run_flow_ab(
    payload: FlowABRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> FlowABRunOut:
    run_a, run_b = flow_service.create_flow_ab_run(
        db, dataset_id=payload.dataset_id, flow_ver_a=payload.flow_ver_a,
        flow_ver_b=payload.flow_ver_b, actor=SYSTEM_USER,
    )
    db.commit()
    db.refresh(run_a)
    db.refresh(run_b)
    a_id, b_id = run_a.run_id, run_b.run_id
    background.add_task(flow_service.execute_flow_dataset_run, run_id=a_id, dataset_id=payload.dataset_id, flow_ver_id=payload.flow_ver_a)
    background.add_task(flow_service.execute_flow_dataset_run, run_id=b_id, dataset_id=payload.dataset_id, flow_ver_id=payload.flow_ver_b)
    return FlowABRunOut(run_a_id=a_id, run_b_id=b_id)


@router.post("/flow/test/ragas", response_model=RagasRunOut)
async def run_flow_ragas(
    payload: FlowRagasRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> RagasRunOut:
    run = flow_service.create_flow_ragas_run(db, dataset_id=payload.dataset_id, metrics=payload.metrics, actor=SYSTEM_USER)
    db.commit()
    db.refresh(run)
    out = RagasRunOut.model_validate(run)
    background.add_task(flow_service.execute_flow_ragas_run, ragas_run_id=run.ragas_run_id, dataset_id=payload.dataset_id)
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
