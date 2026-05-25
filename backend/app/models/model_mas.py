from __future__ import annotations

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ModelMas(Base):
    """Operational model master — available model names (read-only for PM).

    FIXED external table (structure must never change). PM reads
    ``GAIA_MODEL_NM`` to populate the flow main-model selector. Not created by
    alembic (assumed pre-existing in operations); SQLite tests + demo seed create it.
    """

    __tablename__ = "MODEL_MAS"

    id: Mapped[int] = mapped_column("ID", Integer, primary_key=True, autoincrement=True)
    gaia_model_nm: Mapped[str] = mapped_column("GAIA_MODEL_NM", String(100), nullable=False)
