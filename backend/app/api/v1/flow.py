from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.schemas.dataset import DatasetCreate, DatasetDetail, DatasetSummary
from app.schemas.flow import FlowCurrentOut, FlowRagasAbOut, FlowRagasAbRequest, FlowRagasRequest
from app.schemas.ragas import RagasRunOut
from app.services import dataset_service, flow_service

router = APIRouter(tags=["flow"])


@router.get("/flow/current", response_model=FlowCurrentOut)
def get_current_flow(db: Session = Depends(get_db)) -> FlowCurrentOut:
    """The current flow's nodes — drives the node list → per-node prompt management."""
    return flow_service.get_current_flow(db)


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


@router.post("/flow/test/ragas", response_model=RagasRunOut)
async def run_flow_ragas(
    payload: FlowRagasRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> RagasRunOut:
    run = flow_service.create_flow_ragas_run(
        db, dataset_id=payload.dataset_id, metrics=payload.metrics, actor=SYSTEM_USER
    )
    db.commit()
    db.refresh(run)
    out = RagasRunOut.model_validate(run)
    background.add_task(
        flow_service.execute_flow_ragas_run, ragas_run_id=run.ragas_run_id, dataset_id=payload.dataset_id
    )
    return out


@router.post("/flow/test/ragas/ab", response_model=FlowRagasAbOut)
async def run_flow_ragas_ab(
    payload: FlowRagasAbRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> FlowRagasAbOut:
    run_a, run_b = flow_service.create_flow_ragas_ab_run(
        db, dataset_id=payload.dataset_id, node_nm=payload.node_nm,
        prompt_id_a=payload.prompt_id_a, prompt_id_b=payload.prompt_id_b,
        metrics=payload.metrics, actor=SYSTEM_USER,
    )
    db.commit()
    db.refresh(run_a)
    db.refresh(run_b)
    a_id, b_id = run_a.ragas_run_id, run_b.ragas_run_id
    background.add_task(flow_service.execute_flow_ragas_run, ragas_run_id=a_id, dataset_id=payload.dataset_id)
    background.add_task(flow_service.execute_flow_ragas_run, ragas_run_id=b_id, dataset_id=payload.dataset_id)
    return FlowRagasAbOut(ragas_run_a_id=a_id, ragas_run_b_id=b_id)
