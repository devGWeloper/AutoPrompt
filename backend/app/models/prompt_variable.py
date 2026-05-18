from __future__ import annotations

from sqlalchemy import ForeignKey, Identity, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PromptVariable(Base):
    __tablename__ = "PM_PROMPT_VARIABLE"

    var_id: Mapped[int] = mapped_column("VAR_ID", Integer, Identity(always=True), primary_key=True)
    prompt_id: Mapped[int] = mapped_column("PROMPT_ID", Integer, ForeignKey("PM_PROMPT_VERSION.PROMPT_ID"), nullable=False)
    var_name: Mapped[str] = mapped_column("VAR_NAME", String(100), nullable=False)
    var_type: Mapped[str] = mapped_column("VAR_TYPE", String(50), default="STRING", server_default="STRING")
    description: Mapped[str | None] = mapped_column("DESCRIPTION", String(300))
    default_value: Mapped[str | None] = mapped_column("DEFAULT_VALUE", String(500))
    is_required: Mapped[str] = mapped_column("IS_REQUIRED", String(1), default="Y", server_default="Y")
