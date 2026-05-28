from __future__ import annotations

import os

os.environ["APP_ENV"] = "test"
os.environ.setdefault("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.db as db_module
from app.main import create_app
from app.models import (  # noqa: F401  -- register tables on Base.metadata
    audit,
    chat_ver,
    dataset,
    model_mas,
    node_mas,
    node_prompt_ver,
    ragas,
)
from app.models.chat_ver import ChatVerMas
from app.models.model_mas import ModelMas
from app.models.node_mas import NodeMas
from app.models.node_prompt_ver import NodePromptVer


@pytest.fixture
def engine():
    # Fresh in-memory DB per test (function scope) for isolation. StaticPool
    # keeps a single connection so the app's get_db AND the test-run
    # background task share the same in-memory DB. Module globals are
    # rebound so every consumer hits this engine.
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    # Enforce foreign keys on SQLite (off by default) so FK-order bugs that would
    # fail on Oracle (ORA-02292) are caught by the tests too.
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _fk_pragma(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    db_module.Base.metadata.create_all(engine)
    db_module.engine = engine
    db_module.SessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, future=True
    )
    return engine


@pytest.fixture
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection, autoflush=False, autocommit=False, future=True)
    session = Session()
    db_module.engine = engine
    db_module.SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


_SEED_GRAPH = """flowchart TD
    start([START]) --> llm[LLM]
    llm --> done([END])
"""


@pytest.fixture
def seeded_db(engine):
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    s = SessionLocal()
    try:
        # Idempotent seed for shared in-memory engine (no users — auth removed).
        if s.query(ChatVerMas).count() == 0:
            for nm in ("claude-sonnet-4-6", "gemini-2.5-flash", "gpt-4o"):
                s.add(ModelMas(gaia_model_nm=nm))
            chat = ChatVerMas(
                graph_struct=_SEED_GRAPH,
                main_model_nm="claude-sonnet-4-6",
                create_user="system",
            )
            s.add(chat)
            s.flush()
            n1 = NodeMas(
                chat_ver_id=chat.id, node_nm="start", node_desc="start node",
                prompt_edit_enable_yn="N", create_user="system",
            )
            # NODE_MAS.MODEL_NM is NULL — the LLM model is the flow main model.
            n2 = NodeMas(
                chat_ver_id=chat.id, node_nm="llm",
                node_desc="llm node", prompt="You are helpful. Question: {{q}}",
                prompt_edit_enable_yn="Y", model_edit_enable_yn="N",
                main_model_edit_enable_yn="Y", create_user="system",
            )
            n3 = NodeMas(
                chat_ver_id=chat.id, node_nm="done", node_desc="end node",
                prompt_edit_enable_yn="N", create_user="system",
            )
            s.add_all([n1, n2, n3])
            s.flush()
            p1 = NodePromptVer(
                node_mas_id=n2.id, node_nm="llm", version_no="1.0.0",
                system_prompt="You are helpful.", user_prompt="Question: {{q}}",
                is_active="Y", change_summary="seed", change_reason="seed", created_by="system",
            )
            s.add(p1)
            s.commit()
        yield s
    finally:
        s.close()


@pytest.fixture
def client(seeded_db):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_ws_manager():
    # Manager is a module singleton; clear per-test so buffered run history
    # never leaks across tests (run_ids restart at 1 with per-test DB).
    from app.core.ws import manager

    manager._connections.clear()
    manager._history.clear()
    yield
    manager._connections.clear()
    manager._history.clear()
