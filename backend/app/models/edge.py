from __future__ import annotations

from sqlalchemy import ForeignKey, Identity, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NodeEdge(Base):
    __tablename__ = "PM_NODE_EDGE"

    edge_id: Mapped[int] = mapped_column("EDGE_ID", Integer, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column("PROJECT_ID", Integer, ForeignKey("PM_PROJECT.PROJECT_ID"), nullable=False)
    source_node_id: Mapped[int] = mapped_column("SOURCE_NODE_ID", Integer, ForeignKey("PM_NODE.NODE_ID"), nullable=False)
    target_node_id: Mapped[int] = mapped_column("TARGET_NODE_ID", Integer, ForeignKey("PM_NODE.NODE_ID"), nullable=False)
    label: Mapped[str | None] = mapped_column("LABEL", String(100))
    condition_expr: Mapped[str | None] = mapped_column("CONDITION_EXPR", String(500))
