from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.constants import SYSTEM_USER
from app.core.db import get_db
from app.models.node import Node
from app.schemas.dataset import (
    CaseCreate,
    CaseOut,
    CaseUpdate,
    CsvUploadResult,
    DatasetCreate,
    DatasetDetail,
    DatasetSummary,
    DatasetUpdate,
)
from app.services import dataset_service

router = APIRouter(tags=["datasets"])


def _detail(db: Session, ds) -> DatasetDetail:
    return DatasetDetail(
        **DatasetSummary.model_validate(ds).model_dump(),
        case_count=dataset_service.case_count(db, ds.dataset_id),
    )


@router.get("/nodes/{node_id}/datasets", response_model=list[DatasetSummary])
def list_datasets(
    node_id: int,
    db: Session = Depends(get_db),
) -> list[DatasetSummary]:
    if db.get(Node, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    return [DatasetSummary.model_validate(r) for r in dataset_service.list_datasets(db, node_id)]


@router.post(
    "/nodes/{node_id}/datasets",
    response_model=DatasetDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_dataset(
    node_id: int,
    payload: DatasetCreate,
    db: Session = Depends(get_db),
) -> DatasetDetail:
    if db.get(Node, node_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="node not found")
    ds = dataset_service.create_dataset(
        db, node_id=node_id, payload=payload, created_by=SYSTEM_USER
    )
    db.commit()
    db.refresh(ds)
    return _detail(db, ds)


@router.get("/datasets/{dataset_id}", response_model=DatasetDetail)
def get_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
) -> DatasetDetail:
    return _detail(db, dataset_service.get_dataset(db, dataset_id))


@router.put("/datasets/{dataset_id}", response_model=DatasetDetail)
def update_dataset(
    dataset_id: int,
    payload: DatasetUpdate,
    db: Session = Depends(get_db),
) -> DatasetDetail:
    ds = dataset_service.update_dataset(
        db, dataset_id=dataset_id, payload=payload, actor=SYSTEM_USER
    )
    db.commit()
    db.refresh(ds)
    return _detail(db, ds)


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
) -> None:
    dataset_service.delete_dataset(db, dataset_id=dataset_id, actor=SYSTEM_USER)
    db.commit()


@router.get("/datasets/{dataset_id}/cases", response_model=list[CaseOut])
def list_cases(
    dataset_id: int,
    db: Session = Depends(get_db),
) -> list[CaseOut]:
    dataset_service.get_dataset(db, dataset_id)
    return [CaseOut.model_validate(c) for c in dataset_service.list_cases(db, dataset_id)]


@router.post(
    "/datasets/{dataset_id}/cases",
    response_model=CaseOut,
    status_code=status.HTTP_201_CREATED,
)
def create_case(
    dataset_id: int,
    payload: CaseCreate,
    db: Session = Depends(get_db),
) -> CaseOut:
    dataset_service.get_dataset(db, dataset_id)
    case = dataset_service.create_case(
        db, dataset_id=dataset_id, payload=payload, created_by=SYSTEM_USER
    )
    db.commit()
    db.refresh(case)
    return CaseOut.model_validate(case)


@router.put("/datasets/{dataset_id}/cases/{case_id}", response_model=CaseOut)
def update_case(
    dataset_id: int,
    case_id: int,
    payload: CaseUpdate,
    db: Session = Depends(get_db),
) -> CaseOut:
    case = dataset_service.update_case(
        db, dataset_id=dataset_id, case_id=case_id, payload=payload
    )
    db.commit()
    db.refresh(case)
    return CaseOut.model_validate(case)


@router.delete(
    "/datasets/{dataset_id}/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_case(
    dataset_id: int,
    case_id: int,
    db: Session = Depends(get_db),
) -> None:
    dataset_service.delete_case(db, dataset_id=dataset_id, case_id=case_id)
    db.commit()


@router.post("/datasets/{dataset_id}/upload", response_model=CsvUploadResult)
async def upload_csv(
    dataset_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> CsvUploadResult:
    content = await file.read()
    created, skipped, errors = dataset_service.import_csv(
        db, dataset_id=dataset_id, file_bytes=content, created_by=SYSTEM_USER
    )
    db.commit()
    return CsvUploadResult(created=created, skipped=skipped, errors=errors)
