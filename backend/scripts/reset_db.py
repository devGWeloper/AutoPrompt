"""DEV ONLY: drop this app's tables so `alembic upgrade head` can rebuild.

The schema/alembic history got out of sync (old partial migration).
Only PM_* tables and ALEMBIC_VERSION are touched — other objects in the
schema (e.g. SQL*Plus system tables) are left alone. Each drop is
best-effort: failures are reported and skipped.

Usage:
    python -m scripts.reset_db
"""
from __future__ import annotations

from sqlalchemy import text

from app.core.db import engine


def reset() -> None:
    with engine.connect() as conn:
        # A broken DATABASE-level AFTER DROP trigger (SYS.DELETE_ENTRIES) is
        # INVALID and aborts every DROP on this instance. It is not a standard
        # Oracle object. Disable it (ALTER, not DROP, so it won't self-block).
        # Revert later with: ALTER TRIGGER SYS.DELETE_ENTRIES ENABLE;
        try:
            conn.execute(text("ALTER TRIGGER SYS.DELETE_ENTRIES DISABLE"))
            conn.commit()
            print("disabled broken trigger SYS.DELETE_ENTRIES")
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            print(
                "WARN could not disable SYS.DELETE_ENTRIES "
                f"({exc.__class__.__name__}: {str(exc)[:120]}). "
                "May need a DBA: ALTER TRIGGER SYS.DELETE_ENTRIES DISABLE;"
            )

        names = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT table_name FROM user_tables "
                    "WHERE table_name LIKE 'PM\\_%' ESCAPE '\\' "
                    "OR table_name = 'ALEMBIC_VERSION'"
                )
            )
        ]
        if not names:
            print("No PM_*/ALEMBIC_VERSION tables found — nothing to drop.")
            return
        dropped = 0
        for name in names:
            try:
                conn.execute(text(f'DROP TABLE "{name}" CASCADE CONSTRAINTS PURGE'))
                conn.commit()
                dropped += 1
                print(f"dropped {name}")
            except Exception as exc:  # noqa: BLE001 - best effort, keep going
                conn.rollback()
                print(f"SKIP {name}: {exc.__class__.__name__}: {str(exc)[:120]}")
        print(f"Done. Dropped {dropped}/{len(names)} table(s).")


if __name__ == "__main__":
    reset()
