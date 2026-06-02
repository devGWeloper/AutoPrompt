from __future__ import annotations

import csv
import io

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.node_prompt_ver import NodePromptVer
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


def ragas_ab_rows(db: Session, ab_group_id: int) -> Rows:
    """Side-by-side rows for an A/B comparison (two runs sharing ab_group_id).

    Joined on case_id so reviewers see the same question with A's vs B's answer
    and metrics on one row. Version label (e.g. 1.0.0) is attached to the A_/B_
    column prefixes when resolvable.
    """
    runs = (
        db.execute(
            select(RagasRun)
            .where(RagasRun.ab_group_id == ab_group_id)
            .order_by(RagasRun.ragas_run_id.asc())
        )
        .scalars()
        .all()
    )
    if len(runs) != 2:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="ab pair not found")
    run_a, run_b = runs
    label_a, label_b = _ab_labels(db, run_a, run_b)

    def _by_case(run_id: int) -> dict[int | None, RagasResult]:
        rows = (
            db.execute(
                select(RagasResult)
                .where(RagasResult.ragas_run_id == run_id)
                .order_by(RagasResult.ragas_result_id.asc())
            )
            .scalars()
            .all()
        )
        return {r.case_id: r for r in rows}

    a_by, b_by = _by_case(run_a.ragas_run_id), _by_case(run_b.ragas_run_id)
    case_ids: list[int | None] = []
    seen: set[int | None] = set()
    for cid in list(a_by.keys()) + list(b_by.keys()):
        if cid in seen:
            continue
        seen.add(cid)
        case_ids.append(cid)

    header = (
        ["case_id", "question", "ground_truth"]
        + [f"{label_a}_answer", f"{label_b}_answer"]
        + [c for m in ALL_METRICS for c in (f"{label_a}_{m}", f"{label_b}_{m}")]
        + [f"{label_a}_error_msg", f"{label_b}_error_msg"]
    )

    rows: list[list[object]] = []
    for cid in case_ids:
        ra = a_by.get(cid)
        rb = b_by.get(cid)
        question = (ra and ra.question) or (rb and rb.question)
        ground_truth = (ra and ra.ground_truth) or (rb and rb.ground_truth)
        rows.append(
            [cid, question, ground_truth, ra.answer if ra else None, rb.answer if rb else None]
            + [v for m in ALL_METRICS for v in (
                getattr(ra, m) if ra else None,
                getattr(rb, m) if rb else None,
            )]
            + [ra.error_msg if ra else None, rb.error_msg if rb else None]
        )
    return header, rows


def _ab_labels(db: Session, run_a: RagasRun, run_b: RagasRun) -> tuple[str, str]:
    """Return ('A_v<ver>', 'B_v<ver>') labels, falling back to bare 'A'/'B' if no version."""
    def _ver(prompt_id: int | None) -> str | None:
        if prompt_id is None:
            return None
        pv = db.get(NodePromptVer, prompt_id)
        return pv.version_no if pv else None

    va, vb = _ver(run_a.prompt_id), _ver(run_b.prompt_id)
    return (f"A_v{va}" if va else "A", f"B_v{vb}" if vb else "B")


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
