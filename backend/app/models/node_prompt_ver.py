from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NodePromptVer(Base):
    """Node-level prompt version history (PM-owned).

    One row per saved prompt version of a NODE_MAS node. The prompt is split into
    ``SYSTEM_PROMPT`` + ``USER_PROMPT`` here (PM-owned table; NODE_MAS cannot change).
    The external model reads the active row of this table directly to pick up both
    prompts — see the ``connect-prompt-mgmt`` skill.
    """

    __tablename__ = "PM_NODE_PROMPT_VER"
    __table_args__ = (
        UniqueConstraint("NODE_MAS_ID", "VERSION_NO", name="UQ_PM_NODE_PROMPT_VER"),
    )

    prompt_id: Mapped[int] = mapped_column(
        "PROMPT_ID", Integer, Identity(always=True), primary_key=True
    )
    node_mas_id: Mapped[int] = mapped_column(
        "NODE_MAS_ID", Integer, ForeignKey("NODE_MAS.ID"), nullable=False
    )
    # Denormalized node name for resilience/display (NODE_MAS holds only current).
    node_nm: Mapped[str] = mapped_column("NODE_NM", String(200), nullable=False)
    version_no: Mapped[str] = mapped_column("VERSION_NO", String(20), nullable=False)
    system_prompt: Mapped[str | None] = mapped_column("SYSTEM_PROMPT", Text)
    user_prompt: Mapped[str | None] = mapped_column("USER_PROMPT", Text)
    is_active: Mapped[str] = mapped_column("IS_ACTIVE", String(1), default="N", server_default="N")
    change_summary: Mapped[str | None] = mapped_column("CHANGE_SUMMARY", String(500))
    change_reason: Mapped[str | None] = mapped_column("CHANGE_REASON", String(1000))
    prev_prompt_id: Mapped[int | None] = mapped_column(
        "PREV_PROMPT_ID", Integer, ForeignKey("PM_NODE_PROMPT_VER.PROMPT_ID")
    )
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
    updated_dt: Mapped[datetime | None] = mapped_column("UPDATED_DT", DateTime)
