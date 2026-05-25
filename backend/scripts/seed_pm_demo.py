"""Seed PM_* demo data in Oracle from the existing CHAT_VER_MAS / NODE_MAS rows.

DEMO ONLY. After ``alembic upgrade head`` creates the (empty) PM_* tables, this
creates one node prompt version (v1.0.0, active) per LLM node and one active flow
version (v1.0.0) with its manifest, so the UI shows active prompts + a flow
version. Idempotent: skips if a flow version already exists.

Run:  backend/.venv/Scripts/python.exe backend/scripts/seed_pm_demo.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401  -- register metadata
from app.models.chat_ver import ChatVerMas  # noqa: E402
from app.models.flow_ver import FlowVer, FlowVerNode  # noqa: E402
from app.models.node_mas import NodeMas  # noqa: E402
from app.models.node_prompt_ver import NodePromptVer  # noqa: E402

DEFAULT_DSN = "system/orcl@localhost:1521/orcl"


def sqlalchemy_url() -> str:
    dsn = DEFAULT_DSN
    env = BACKEND / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ORACLE_DSN="):
                dsn = line.split("=", 1)[1].strip()
                break
    m = re.match(r"^([^/]+)/([^@]+)@([^:/]+):(\d+)/(.+)$", dsn)
    if not m:
        raise SystemExit(f"cannot parse ORACLE_DSN={dsn!r}")
    user, pw, host, port, service = m.groups()
    return f"oracle+oracledb://{user}:{pw}@{host}:{port}/?service_name={service}"


def main() -> int:
    engine = create_engine(sqlalchemy_url(), future=True)
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        chat = s.execute(select(ChatVerMas).order_by(ChatVerMas.id.desc()).limit(1)).scalars().first()
        if chat is None:
            raise SystemExit("no CHAT_VER_MAS row — run demo_seed_oracle.py first")
        if s.execute(select(FlowVer).where(FlowVer.chat_ver_id == chat.id)).scalars().first():
            print("PM demo already seeded (flow version exists) — nothing to do.")
            return 0

        nodes = s.execute(
            select(NodeMas).where(NodeMas.chat_ver_id == chat.id).order_by(NodeMas.id.asc())
        ).scalars().all()

        active_by_node: dict[int, NodePromptVer] = {}
        for n in nodes:
            if (n.prompt_edit_enable_yn or "N").upper() == "Y" and n.prompt:
                # NODE_MAS holds a single prompt -> seed it as the SYSTEM_PROMPT
                # (what activation mirrors back); USER_PROMPT starts empty.
                pv = NodePromptVer(
                    node_mas_id=n.id, node_nm=n.node_nm, version_no="1.0.0",
                    system_prompt=n.prompt, user_prompt="", model_nm=n.model_nm, is_active="Y",
                    change_summary="seed (from NODE_MAS)", change_reason="initial import",
                    created_by="system",
                )
                s.add(pv)
                s.flush()
                active_by_node[n.id] = pv

        fv = FlowVer(
            chat_ver_id=chat.id, flow_version_no="1.0.0", graph_struct=chat.graph_struct,
            main_model_nm=chat.main_model_nm, is_active="Y",
            change_summary="seed", created_by="system",
        )
        s.add(fv)
        s.flush()
        for n in nodes:
            pv = active_by_node.get(n.id)
            s.add(FlowVerNode(
                flow_ver_id=fv.flow_ver_id, node_mas_id=n.id, node_nm=n.node_nm,
                prompt_id=pv.prompt_id if pv else None,
                version_no=pv.version_no if pv else None,
            ))
        s.commit()

        print(f"Seeded PM demo: {len(active_by_node)} node prompt version(s), flow v1.0.0")
        for n in nodes:
            pv = active_by_node.get(n.id)
            print(f"  node #{n.id} {n.node_nm:<10} -> {'v'+pv.version_no if pv else '(no prompt)'}")
        return 0
    finally:
        s.close()


if __name__ == "__main__":
    sys.exit(main())
