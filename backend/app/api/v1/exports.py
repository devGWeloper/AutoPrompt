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


@router.get("/test-runs/{run_id}/export")
def export_test_run(
    run_id: int,
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    rows = export_service.test_run_rows(db, run_id)
    body, media, ext = export_service.serialize(rows, fmt)
    return _stream(body, media, f"test-run-{run_id}.{ext}")


@router.get("/ragas-runs/{ragas_run_id}/export")
def export_ragas_run(
    ragas_run_id: int,
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    rows = export_service.ragas_run_rows(db, ragas_run_id)
    body, media, ext = export_service.serialize(rows, fmt)
    return _stream(body, media, f"ragas-run-{ragas_run_id}.{ext}")
