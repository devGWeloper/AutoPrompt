from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Identity, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Project(Base):
    __tablename__ = "PM_PROJECT"

    project_id: Mapped[int] = mapped_column("PROJECT_ID", Integer, Identity(always=True), primary_key=True)
    project_nm: Mapped[str] = mapped_column("PROJECT_NM", String(100), nullable=False)
    description: Mapped[str | None] = mapped_column("DESCRIPTION", String(500))
    status: Mapped[str] = mapped_column("STATUS", String(20), default="ACTIVE", server_default="ACTIVE")
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
    updated_by: Mapped[str | None] = mapped_column("UPDATED_BY", String(50))
    updated_dt: Mapped[datetime | None] = mapped_column("UPDATED_DT", DateTime)
