"""Create ONLY the PM_* tables in the target Oracle DB — the SAFE setup path.

For an internal DB whose existing tables (CHAT_VER_MAS / NODE_MAS / MODEL_MAS,
owned by the operational agent) **must never be created, altered, or dropped**.

What it does:
- Uses the SAME connection as the app (ORACLE_USER / ORACLE_PASSWORD / ORACLE_DSN
  from backend/.env via Settings).
- Creates only tables whose name starts with ``PM_`` (with checkfirst=True, so any
  PM_* table that already exists is skipped — never re-created or altered).
- NEVER touches CHAT_VER_MAS / NODE_MAS / MODEL_MAS (they are not in the create
  list; their FKs are referenced, which does not modify them).
- Inserts NO data (unlike the demo seed scripts).

Run (preview only — lists tables, executes nothing):
    backend/.venv/Scripts/python.exe backend/scripts/create_pm_tables.py --dry-run
Run (create the PM_* tables):
    backend/.venv/Scripts/python.exe backend/scripts/create_pm_tables.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import app.models  # noqa: E402,F401  -- register every table on Base.metadata
from app.core.db import Base, engine  # noqa: E402

# Agent-owned external tables: read-only for PM, never created/altered/dropped.
EXTERNAL = {"CHAT_VER_MAS", "NODE_MAS", "MODEL_MAS"}


def _pm_tables() -> list:
    return [t for name, t in Base.metadata.tables.items() if name.startswith("PM_")]


def main() -> int:
    pm = _pm_tables()
    external_in_meta = sorted(EXTERNAL & set(Base.metadata.tables))

    print("Will CREATE only these (checkfirst=True → existing ones skipped):")
    for name in sorted(t.name for t in pm):
        print(f"  + {name}")
    print(f"\nWill NOT touch (external, read-only): {', '.join(external_in_meta)}")

    if "--dry-run" in sys.argv:
        print("\n[dry-run] no DDL executed.")
        return 0

    # tables=pm restricts DDL to the PM_* list; referenced external tables are
    # NOT created. checkfirst skips any PM_* table that already exists.
    Base.metadata.create_all(engine, tables=pm, checkfirst=True)
    print("\nDone. Only PM_* tables were created; external tables untouched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
