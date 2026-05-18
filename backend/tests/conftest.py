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
    edge,
    node,
    project,
    prompt,
    prompt_variable,
    ragas,
    test_run,
)
from app.models.edge import NodeEdge
from app.models.node import Node
from app.models.project import Project
from app.models.prompt import PromptVersion


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
        # Idempotent seed for shared in-memory engine (no users — auth removed).
        if s.query(Project).count() == 0:
            project = Project(project_nm="Demo", description=None, created_by="system")
            s.add(project)
            s.flush()
            n1 = Node(project_id=project.project_id, node_key="start", node_nm="Start", node_type="START", created_by="system")
            n2 = Node(project_id=project.project_id, node_key="llm", node_nm="LLM", node_type="LLM", created_by="system")
            s.add_all([n1, n2])
            s.flush()
            s.add(NodeEdge(project_id=project.project_id, source_node_id=n1.node_id, target_node_id=n2.node_id))
            p1 = PromptVersion(
                node_id=n2.node_id,
                version_no="1.0.0",
                system_prompt="You are helpful.",
                user_prompt="Question: {{q}}",
                model_provider="anthropic",
                model_nm="claude-sonnet-4-6",
                is_active="Y",
                change_summary="seed",
                change_reason="seed",
                created_by="system",
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


@pytest.fixture
def stub_llm(monkeypatch):
    """Replace the LLM adapter factory with a deterministic offline stub.

    The stub echoes the rendered user prompt so tests can assert {{var}}
    substitution without any real provider call.
    """
    from app.services.llm.base import InvocationResult, render_template

    class _StubAdapter:
        def __init__(self, model: str) -> None:
            self.model = model

        async def invoke(self, *, system_prompt, user_prompt, variables):
            rendered = render_template(user_prompt, variables)
            return InvocationResult(
                output=f"STUB::{rendered}",
                input_tokens=3,
                output_tokens=5,
                latency_ms=7,
                model=self.model,
            )

    def _factory(provider, model, **kwargs):
        return _StubAdapter(model)

    monkeypatch.setattr("app.services.test_service.get_adapter", _factory)
    return _factory


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
