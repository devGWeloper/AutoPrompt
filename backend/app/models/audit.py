from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Identity, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuditLog(Base):
    __tablename__ = "PM_AUDIT_LOG"

    log_id: Mapped[int] = mapped_column("LOG_ID", Integer, Identity(always=True), primary_key=True)
    target_table: Mapped[str] = mapped_column("TARGET_TABLE", String(50), nullable=False)
    target_id: Mapped[int] = mapped_column("TARGET_ID", Integer, nullable=False)
    action: Mapped[str] = mapped_column("ACTION", String(20), nullable=False)
    before_value: Mapped[str | None] = mapped_column("BEFORE_VALUE", Text)
    after_value: Mapped[str | None] = mapped_column("AFTER_VALUE", Text)
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
