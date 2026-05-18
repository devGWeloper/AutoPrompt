from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Identity, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Node(Base):
    __tablename__ = "PM_NODE"
    __table_args__ = (UniqueConstraint("PROJECT_ID", "NODE_KEY", name="UQ_PM_NODE_KEY"),)

    node_id: Mapped[int] = mapped_column("NODE_ID", Integer, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column("PROJECT_ID", Integer, ForeignKey("PM_PROJECT.PROJECT_ID"), nullable=False)
    node_key: Mapped[str] = mapped_column("NODE_KEY", String(100), nullable=False)
    node_nm: Mapped[str] = mapped_column("NODE_NM", String(200), nullable=False)
    node_type: Mapped[str | None] = mapped_column("NODE_TYPE", String(50))
    pos_x: Mapped[float | None] = mapped_column("POS_X", Float)
    pos_y: Mapped[float | None] = mapped_column("POS_Y", Float)
    description: Mapped[str | None] = mapped_column("DESCRIPTION", String(1000))
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
