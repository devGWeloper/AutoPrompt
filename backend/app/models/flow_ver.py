from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Identity, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class FlowVer(Base):
    """Flow-level version history (PM-owned).

    A new row is cut every time a node prompt is activated: the whole flow's
    version number bumps. ``CHAT_VER_ID`` points at the current CHAT_VER_MAS row;
    ``GRAPH_STRUCT`` / ``MAIN_MODEL_NM`` are snapshots for traceability.
    """

    __tablename__ = "PM_FLOW_VER"

    flow_ver_id: Mapped[int] = mapped_column(
        "FLOW_VER_ID", Integer, Identity(always=True), primary_key=True
    )
    chat_ver_id: Mapped[int] = mapped_column("CHAT_VER_ID", Integer, nullable=False)
    flow_version_no: Mapped[str] = mapped_column("FLOW_VERSION_NO", String(20), nullable=False)
    graph_struct: Mapped[str | None] = mapped_column("GRAPH_STRUCT", Text)
    main_model_nm: Mapped[str | None] = mapped_column("MAIN_MODEL_NM", String(100))
    is_active: Mapped[str] = mapped_column("IS_ACTIVE", String(1), default="N", server_default="N")
    change_summary: Mapped[str | None] = mapped_column("CHANGE_SUMMARY", String(500))
    change_reason: Mapped[str | None] = mapped_column("CHANGE_REASON", String(1000))
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )


class FlowVerNode(Base):
    """Per-flow-version manifest: which node prompt version was bound at that flow version."""

    __tablename__ = "PM_FLOW_VER_NODE"

    id: Mapped[int] = mapped_column("ID", Integer, Identity(always=True), primary_key=True)
    flow_ver_id: Mapped[int] = mapped_column(
        "FLOW_VER_ID", Integer, ForeignKey("PM_FLOW_VER.FLOW_VER_ID"), nullable=False
    )
    node_mas_id: Mapped[int] = mapped_column("NODE_MAS_ID", Integer, nullable=False)
    node_nm: Mapped[str] = mapped_column("NODE_NM", String(200), nullable=False)
    prompt_id: Mapped[int | None] = mapped_column(
        "PROMPT_ID", Integer, ForeignKey("PM_NODE_PROMPT_VER.PROMPT_ID")
    )
    version_no: Mapped[str | None] = mapped_column("VERSION_NO", String(20))
