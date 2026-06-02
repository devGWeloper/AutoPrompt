from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SystemConfig(Base):
    """System-wide single-row toggle.

    PM_SYSTEM_CONFIG holds exactly one row whose ENABLED_YN is 'Y' or 'N'. PM
    reads/writes this flag; the external model does NOT consult it.

    SQLAlchemy requires a primary key on every mapped table, so ENABLED_YN
    itself is the PK — fine because the table is meant to hold one row.
    """

    __tablename__ = "PM_SYSTEM_CONFIG"

    enabled_yn: Mapped[str] = mapped_column(
        "ENABLED_YN",
        String(1),
        primary_key=True,
        default="N",
        server_default="N",
        nullable=False,
    )
