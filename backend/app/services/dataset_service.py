from __future__ import annotations

import csv
import io

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.models.dataset import TestCase, TestDataset
from app.models.ragas import RagasResult, RagasRun
from app.schemas.dataset import CaseCreate, CaseUpdate, DatasetCreate, DatasetUpdate
from app.services import audit as audit_service

CSV_COLUMNS = ("input_json", "expected_output", "eval_criteria", "case_type")


# ---- datasets -------------------------------------------------------------

def list_flow_datasets(db: Session) -> list[TestDataset]:
    rows = (
        db.execute(
            select(TestDataset).order_by(TestDataset.created_dt.desc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def create_flow_dataset(db: Session, *, payload: DatasetCreate, created_by: str) -> TestDataset:
    ds = TestDataset(
        dataset_nm=payload.dataset_nm,
        description=payload.description,
        is_active="Y",
        created_by=created_by,
    )
    db.add(ds)
    db.flush()
    audit_service.write_audit(
        db,
        target_table="PM_TEST_DATASET",
        target_id=ds.dataset_id,
        action="CREATE",
        before=None,
        after={"dataset_id": ds.dataset_id, "dataset_nm": ds.dataset_nm},
        created_by=created_by,
    )
    return ds


def get_dataset(db: Session, dataset_id: int) -> TestDataset:
    obj = db.get(TestDataset, dataset_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="dataset not found")
    return obj


def case_count(db: Session, dataset_id: int) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(TestCase)
            .where(TestCase.dataset_id == dataset_id)
        ).scalar_one()
    )


def update_dataset(
    db: Session, *, dataset_id: int, payload: DatasetUpdate, actor: str
) -> TestDataset:
    ds = get_dataset(db, dataset_id)
    before = {
        "dataset_nm": ds.dataset_nm,
        "description": ds.description,
        "is_active": ds.is_active,
    }
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(ds, field, value)
    db.flush()
    audit_service.write_audit(
        db,
        target_table="PM_TEST_DATASET",
        target_id=ds.dataset_id,
        action="UPDATE",
        before=before,
        after=data,
        created_by=actor,
    )
    return ds


def delete_dataset(db: Session, *, dataset_id: int, actor: str) -> None:
    """Delete a dataset and every row that depends on it, in FK order.

    The dependency chain is PM_RAGAS_RESULT → (PM_RAGAS_RUN, PM_TEST_CASE) →
    PM_TEST_DATASET, so results must go first, then the runs and cases, then the
    dataset itself — otherwise Oracle rejects the parent delete (ORA-02292).
    """
    ds = get_dataset(db, dataset_id)
    run_ids = (
        db.execute(select(RagasRun.ragas_run_id).where(RagasRun.dataset_id == dataset_id))
        .scalars()
        .all()
    )
    case_ids = (
        db.execute(select(TestCase.case_id).where(TestCase.dataset_id == dataset_id))
        .scalars()
        .all()
    )
    # Per-case results reference both a run and a case; clear them first.
    result_conds = []
    if run_ids:
        result_conds.append(RagasResult.ragas_run_id.in_(run_ids))
    if case_ids:
        result_conds.append(RagasResult.case_id.in_(case_ids))
    if result_conds:
        db.execute(delete(RagasResult).where(or_(*result_conds)))
    db.execute(delete(RagasRun).where(RagasRun.dataset_id == dataset_id))
    db.execute(delete(TestCase).where(TestCase.dataset_id == dataset_id))
    db.flush()  # children before parent (FK order)
    db.delete(ds)
    db.flush()
    audit_service.write_audit(
        db,
        target_table="PM_TEST_DATASET",
        target_id=dataset_id,
        action="DELETE",
        before={"dataset_id": dataset_id, "dataset_nm": ds.dataset_nm},
        after=None,
        created_by=actor,
    )


# ---- cases ----------------------------------------------------------------

def list_cases(db: Session, dataset_id: int) -> list[TestCase]:
    rows = (
        db.execute(
            select(TestCase)
            .where(TestCase.dataset_id == dataset_id)
            .order_by(TestCase.case_id.asc())
        )
        .scalars()
        .all()
    )
    return list(rows)


def get_case(db: Session, dataset_id: int, case_id: int) -> TestCase:
    obj = db.get(TestCase, case_id)
    if obj is None or obj.dataset_id != dataset_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="test case not found")
    return obj


def create_case(
    db: Session, *, dataset_id: int, payload: CaseCreate, created_by: str
) -> TestCase:
    case = TestCase(
        dataset_id=dataset_id,
        input_data=payload.input_data,
        expected_output=payload.expected_output,
        eval_criteria=payload.eval_criteria,
        case_type=payload.case_type,
        created_by=created_by,
    )
    db.add(case)
    db.flush()
    return case


def update_case(
    db: Session, *, dataset_id: int, case_id: int, payload: CaseUpdate
) -> TestCase:
    case = get_case(db, dataset_id, case_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(case, field, value)
    db.flush()
    return case


def delete_case(db: Session, *, dataset_id: int, case_id: int) -> None:
    case = get_case(db, dataset_id, case_id)
    db.delete(case)
    db.flush()


def import_csv(
    db: Session, *, dataset_id: int, file_bytes: bytes, created_by: str
) -> tuple[int, int, list[str]]:
    """Bulk-import cases from CSV. Returns (created, skipped, errors)."""
    get_dataset(db, dataset_id)
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="file must be UTF-8 CSV")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "input_json" not in reader.fieldnames:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"CSV must have header columns: {', '.join(CSV_COLUMNS)}",
        )

    created = 0
    skipped = 0
    errors: list[str] = []
    for idx, row in enumerate(reader, start=2):  # row 1 is the header
        input_data = (row.get("input_json") or "").strip()
        if not input_data:
            skipped += 1
            errors.append(f"row {idx}: empty input_json")
            continue
        db.add(
            TestCase(
                dataset_id=dataset_id,
                input_data=input_data,
                expected_output=(row.get("expected_output") or "").strip() or None,
                eval_criteria=(row.get("eval_criteria") or "").strip() or None,
                case_type=(row.get("case_type") or "").strip() or "NORMAL",
                created_by=created_by,
            )
        )
        created += 1

    db.flush()
    audit_service.write_audit(
        db,
        target_table="PM_TEST_DATASET",
        target_id=dataset_id,
        action="UPDATE",
        before=None,
        after={"csv_import": {"created": created, "skipped": skipped}},
        created_by=created_by,
    )
    return created, skipped, errors
