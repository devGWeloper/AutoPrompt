from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.system_config import SystemConfigOut, SystemConfigUpdate
from app.services import system_config_service

router = APIRouter(tags=["system-config"])


@router.get("/system-config", response_model=SystemConfigOut)
def get_system_config(db: Session = Depends(get_db)) -> SystemConfigOut:
    return SystemConfigOut(enabled_yn=system_config_service.get_enabled(db))


@router.put("/system-config", response_model=SystemConfigOut)
def set_system_config(
    payload: SystemConfigUpdate, db: Session = Depends(get_db)
) -> SystemConfigOut:
    return SystemConfigOut(
        enabled_yn=system_config_service.set_enabled(db, enabled_yn=payload.enabled_yn)
    )
