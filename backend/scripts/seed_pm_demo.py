"""Seed one PM_NODE_PROMPT_VER demo row so the UI has something to show.

DEMO ONLY. After ``alembic upgrade head`` creates the (empty) PM_* tables, this
inserts a single node ("llm") with an active v1.0.0 prompt. Idempotent: skips if
any prompt version already exists.

Run:  backend/.venv/Scripts/python.exe backend/scripts/seed_pm_demo.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401  -- register metadata
from app.core.config import get_settings  # noqa: E402
from app.models.node_prompt_ver import NodePromptVer  # noqa: E402


def main() -> int:
    settings = get_settings()
    engine = create_engine(
        settings.sqlalchemy_url(),
        connect_args=settings.oracle_connect_args(),
        future=True,
    )
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        if s.execute(select(NodePromptVer).limit(1)).scalars().first():
            print("PM demo already seeded (prompt version exists) — nothing to do.")
            return 0

        pv = NodePromptVer(
            node_nm="llm",
            version_no="1.0.0",
            system_prompt="You are helpful.",
            user_prompt="Question: {{q}}",
            model_nm="claude-sonnet-4-6",
            is_active="Y",
            change_summary="seed",
            change_reason="initial demo",
            created_by="system",
        )
        s.add(pv)
        s.commit()
        print(f"Seeded PM demo: node 'llm' v1.0.0 (prompt_id={pv.prompt_id})")
        return 0
    finally:
        s.close()


if __name__ == "__main__":
    sys.exit(main())
