"""Seed PM_* demo data in Oracle from the existing CHAT_VER_MAS / NODE_MAS rows.

DEMO ONLY. After ``alembic upgrade head`` creates the (empty) PM_* tables, this
creates one node prompt version (v1.0.0, active) per LLM node, so the UI shows
active prompts. Idempotent: skips if any node prompt version already exists.

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
from app.models.chat_ver import ChatVerMas  # noqa: E402
from app.models.node_mas import NodeMas  # noqa: E402
from app.models.node_prompt_ver import NodePromptVer  # noqa: E402


def main() -> int:
    s = get_settings()
    # Same connection path as the app: bare oracle+oracledb URL + user/password/
    # dsn handed through connect_args, so any DSN form (Easy Connect / tnsnames
    # alias / full (DESCRIPTION=...) descriptor) works unchanged.
    engine = create_engine(
        s.sqlalchemy_url(), connect_args=s.oracle_connect_args(), future=True
    )
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        chat = s.execute(select(ChatVerMas).order_by(ChatVerMas.id.desc()).limit(1)).scalars().first()
        if chat is None:
            raise SystemExit("no CHAT_VER_MAS row — run demo_seed_oracle.py first")

        nodes = s.execute(
            select(NodeMas).where(NodeMas.chat_ver_id == chat.id).order_by(NodeMas.id.asc())
        ).scalars().all()
        node_ids = [n.id for n in nodes]
        if node_ids and s.execute(
            select(NodePromptVer).where(NodePromptVer.node_mas_id.in_(node_ids)).limit(1)
        ).scalars().first():
            print("PM demo already seeded (node prompt version exists) — nothing to do.")
            return 0

        seeded: dict[int, NodePromptVer] = {}
        for n in nodes:
            if (n.prompt_edit_enable_yn or "N").upper() == "Y" and n.prompt:
                # NODE_MAS holds a single prompt -> seed it as the SYSTEM_PROMPT
                # (what activation mirrors back); USER_PROMPT starts empty.
                pv = NodePromptVer(
                    node_mas_id=n.id, node_nm=n.node_nm, version_no="1.0.0",
                    system_prompt=n.prompt, user_prompt="", is_active="Y",
                    change_summary="seed (from NODE_MAS)", change_reason="initial import",
                    created_by="system",
                )
                s.add(pv)
                s.flush()
                seeded[n.id] = pv
        s.commit()

        print(f"Seeded PM demo: {len(seeded)} node prompt version(s)")
        for n in nodes:
            pv = seeded.get(n.id)
            print(f"  node #{n.id} {n.node_nm:<10} -> {'v'+pv.version_no if pv else '(no prompt)'}")
        return 0
    finally:
        s.close()


if __name__ == "__main__":
    sys.exit(main())
