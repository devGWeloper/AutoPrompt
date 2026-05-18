from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PromptVersion(Base):
    __tablename__ = "PM_PROMPT_VERSION"
    __table_args__ = (UniqueConstraint("NODE_ID", "VERSION_NO", name="UQ_PM_PROMPT_VERSION"),)

    prompt_id: Mapped[int] = mapped_column("PROMPT_ID", Integer, Identity(always=True), primary_key=True)
    node_id: Mapped[int] = mapped_column("NODE_ID", Integer, ForeignKey("PM_NODE.NODE_ID"), nullable=False)
    version_no: Mapped[str] = mapped_column("VERSION_NO", String(20), nullable=False)
    system_prompt: Mapped[str | None] = mapped_column("SYSTEM_PROMPT", Text)
    user_prompt: Mapped[str | None] = mapped_column("USER_PROMPT", Text)
    # Model settings live on the prompt version itself (no separate config entity).
    model_provider: Mapped[str] = mapped_column("MODEL_PROVIDER", String(50), nullable=False)
    model_nm: Mapped[str] = mapped_column("MODEL_NM", String(100), nullable=False)
    temperature: Mapped[Decimal | None] = mapped_column("TEMPERATURE", Numeric(3, 2))
    max_tokens: Mapped[int | None] = mapped_column("MAX_TOKENS", Integer)
    top_p: Mapped[Decimal | None] = mapped_column("TOP_P", Numeric(3, 2))
    extra_params: Mapped[str | None] = mapped_column("EXTRA_PARAMS", Text)
    is_active: Mapped[str] = mapped_column("IS_ACTIVE", String(1), default="N", server_default="N")
    change_summary: Mapped[str | None] = mapped_column("CHANGE_SUMMARY", String(500))
    change_reason: Mapped[str | None] = mapped_column("CHANGE_REASON", String(1000))
    prev_prompt_id: Mapped[int | None] = mapped_column(
        "PREV_PROMPT_ID", Integer, ForeignKey("PM_PROMPT_VERSION.PROMPT_ID")
    )
    created_by: Mapped[str] = mapped_column("CREATED_BY", String(50), nullable=False)
    created_dt: Mapped[datetime] = mapped_column(
        "CREATED_DT", DateTime, server_default=func.current_timestamp()
    )
