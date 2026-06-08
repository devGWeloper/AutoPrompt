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
    dataset,
    node_prompt_ver,
    ragas,
)
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


@pytest.fixture
def seeded_db(engine):
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    s = SessionLocal()
    try:
        # Idempotent seed: one node ("llm") with one prompt version. No persistent
        # active version — IS_ACTIVE is only set transiently during a test run.
        if s.query(NodePromptVer).count() == 0:
            p1 = NodePromptVer(
                node_nm="llm", version_no="1.0.0",
                system_prompt="You are helpful.", user_prompt="Question: {{q}}",
                model_nm="claude-sonnet-4-6",
                is_active="N", change_summary="seed", change_reason="seed", created_by="system",
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
