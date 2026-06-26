from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.schemas.dataset import DatasetCreate, DatasetDetail, DatasetSummary
from app.schemas.flow import (
    DirectCaseResult,
    DirectDatasetOut,
    DirectDatasetRequest,
    DirectTestOut,
    DirectTestRequest,
    FlowCurrentOut,
    FlowRagasAbOut,
    FlowRagasAbRequest,
    FlowRagasRequest,
)
from app.schemas.ragas import RagasRunOut
from app.services import dataset_service, external_agent, flow_service

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


@router.post("/flow/test/direct", response_model=DirectTestOut)
async def run_flow_direct(payload: DirectTestRequest) -> DirectTestOut:
    """Smoke-test the external chat API directly — no DB, no dataset, no scoring.
    Relays the message straight to the endpoint and returns its answer as-is."""
    try:
        data = await external_agent.run_direct(
            message=payload.message,
            base_url=payload.base_url,
            auth_key=payload.auth_key,
            user_id=payload.user_id,
        )
    except external_agent.ExternalAgentError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return DirectTestOut(**data)


@router.post("/flow/test/direct/dataset", response_model=DirectDatasetOut)
async def run_flow_direct_dataset(
    payload: DirectDatasetRequest, db: Session = Depends(get_db)
) -> DirectDatasetOut:
    """Direct external-API call over every case of a dataset — no scoring, nothing
    persisted. Reads the cases and relays each question, returning the answers."""
    try:
        rows = await flow_service.run_direct_dataset(
            db,
            dataset_id=payload.dataset_id,
            base_url=payload.base_url,
            auth_key=payload.auth_key,
            user_id=payload.user_id,
        )
    except external_agent.ExternalAgentError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return DirectDatasetOut(results=[DirectCaseResult(**r) for r in rows])


@router.post("/flow/test/ragas", response_model=RagasRunOut)
async def run_flow_ragas(
    payload: FlowRagasRequest, background: BackgroundTasks, db: Session = Depends(get_db)
) -> RagasRunOut:
    run = flow_service.create_flow_ragas_run(
        db,
        dataset_id=payload.dataset_id,
        metrics=payload.metrics,
        actor=SYSTEM_USER,
        node_nm=payload.node_nm,
        prompt_id=payload.prompt_id,
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
    # One orchestrated task interleaves the phases (A answers → B answers →
    # A scores → B scores) so both versions' answers appear before scoring.
    background.add_task(
        flow_service.execute_flow_ragas_ab_run,
        ragas_run_a_id=a_id, ragas_run_b_id=b_id, dataset_id=payload.dataset_id,
    )
    return FlowRagasAbOut(ragas_run_a_id=a_id, ragas_run_b_id=b_id)
