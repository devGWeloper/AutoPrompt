from __future__ import annotations

import csv
import io

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ragas import RagasResult, RagasRun
from app.services.ragas.base import ALL_METRICS

Rows = tuple[list[str], list[list[object]]]


def ragas_run_rows(db: Session, ragas_run_id: int) -> Rows:
    run = db.get(RagasRun, ragas_run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="ragas run not found")
    results = (
        db.execute(
            select(RagasResult)
            .where(RagasResult.ragas_run_id == ragas_run_id)
            .order_by(RagasResult.ragas_result_id.asc())
        )
        .scalars()
        .all()
    )
    header = ["ragas_result_id", "case_id", "question", "answer",
              "ground_truth", *ALL_METRICS, "error_msg"]
    rows = [
        [r.ragas_result_id, r.case_id, r.question, r.answer, r.ground_truth,
         *[getattr(r, m) for m in ALL_METRICS], r.error_msg]
        for r in results
    ]
    return header, rows


def to_csv(rows: Rows) -> bytes:
    header, data = rows
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(data)
    return buf.getvalue().encode("utf-8-sig")  # BOM so Excel reads UTF-8


def to_xlsx(rows: Rows) -> bytes:
    from openpyxl import Workbook

    header, data = rows
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for row in data:
        ws.append([str(c) if c is not None else None for c in row])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


CSV_MEDIA = "text/csv"
XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def serialize(rows: Rows, fmt: str) -> tuple[bytes, str, str]:
    """Return (body, media_type, extension) for fmt in {csv, xlsx}."""
    if fmt == "csv":
        return to_csv(rows), CSV_MEDIA, "csv"
    if fmt == "xlsx":
        return to_xlsx(rows), XLSX_MEDIA, "xlsx"
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST, detail="fmt must be 'csv' or 'xlsx'"
    )
