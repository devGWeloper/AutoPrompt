from __future__ import annotations

import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.services import export_service

router = APIRouter(tags=["exports"])


def _stream(body: bytes, media: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(body),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/ragas-runs/{ragas_run_id}/export")
def export_ragas_run(
    ragas_run_id: int,
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    rows = export_service.ragas_run_rows(db, ragas_run_id)
    body, media, ext = export_service.serialize(rows, fmt)
    return _stream(body, media, f"ragas-run-{ragas_run_id}.{ext}")


@router.get("/ragas-runs/ab/{ab_group_id}/export")
def export_ragas_ab(
    ab_group_id: int,
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Side-by-side A/B export — one row per case with A and B answers + metrics."""
    rows = export_service.ragas_ab_rows(db, ab_group_id)
    body, media, ext = export_service.serialize(rows, fmt)
    return _stream(body, media, f"ragas-ab-{ab_group_id}.{ext}")
