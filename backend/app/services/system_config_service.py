from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.system_config import SystemConfig


def get_enabled(db: Session) -> str:
    """Read the current global toggle. If the table is empty (e.g. fresh
    SQLite test DB), bootstrap a single 'N' row so reads always succeed."""
    row = db.query(SystemConfig).first()
    if row is None:
        row = SystemConfig(enabled_yn="N")
        db.add(row)
        db.commit()
    return row.enabled_yn


def set_enabled(db: Session, *, enabled_yn: str) -> str:
    """Update the single row to ``enabled_yn``. Caller should have already
    validated the value (Pydantic Literal at the schema layer).

    ``ENABLED_YN`` is the table's PK, so a raw SQL UPDATE is used instead of
    ORM attribute mutation (which would change the identity key).
    """
    row = db.query(SystemConfig).first()
    if row is None:
        db.add(SystemConfig(enabled_yn=enabled_yn))
    else:
        db.execute(text("UPDATE PM_SYSTEM_CONFIG SET ENABLED_YN = :v"), {"v": enabled_yn})
    db.commit()
    return enabled_yn
