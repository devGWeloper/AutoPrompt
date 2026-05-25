from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NodeMas(Base):
    """Operational node master — the current nodes of the current flow.

    FIXED external table (structure must never change). Holds the CURRENT prompt
    per node; the prompt-management system writes ONLY ``PROMPT``/``UPDATE_DATE``
    (and ``MODEL_NM`` when model editing is enabled) on activation. Version history
    lives in PM_NODE_PROMPT_VER. ``PROMPT_EDIT_ENABLE_YN='Y'`` marks an LLM/prompt
    node (the only nodes whose prompts can be managed).
    """

    __tablename__ = "NODE_MAS"

    id: Mapped[int] = mapped_column("ID", Integer, primary_key=True, autoincrement=True)
    chat_ver_id: Mapped[int] = mapped_column(
        "CHAT_VER_ID", Integer, ForeignKey("CHAT_VER_MAS.ID"), nullable=False
    )
    node_nm: Mapped[str] = mapped_column("NODE_NM", String(200), nullable=False)
    model_nm: Mapped[str | None] = mapped_column("MODEL_NM", String(100))
    node_desc: Mapped[str | None] = mapped_column("NODE_DESC", String(1000))
    prompt: Mapped[str | None] = mapped_column("PROMPT", Text)
    prompt_edit_enable_yn: Mapped[str] = mapped_column(
        "PROMPT_EDIT_ENABLE_YN", String(1), default="N", server_default="N"
    )
    model_edit_enable_yn: Mapped[str] = mapped_column(
        "MODEL_EDIT_ENABLE_YN", String(1), default="N", server_default="N"
    )
    main_model_edit_enable_yn: Mapped[str] = mapped_column(
        "MAIN_MODEL_EDIT_ENABLE_YN", String(1), default="N", server_default="N"
    )
    create_date: Mapped[datetime | None] = mapped_column(
        "CREATE_DATE", DateTime, server_default=func.current_timestamp()
    )
    update_date: Mapped[datetime | None] = mapped_column("UPDATE_DATE", DateTime)
    create_user: Mapped[str | None] = mapped_column("CREATE_USER", String(50))
    update_user: Mapped[str | None] = mapped_column("UPDATE_USER", String(50))
