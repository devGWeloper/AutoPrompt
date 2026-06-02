"""Engine-selection unit tests for app.services.ragas (no network).

Never calls RagasScorer.score() — only verifies which scorer get_scorer() returns
under each RAGAS_ENGINE mode and gateway-config combination.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.services.ragas as rg
from app.services.ragas import FallbackScorer, RagasEngine, get_scorer


def _settings(*, llm_endpoint: str = "", engine: str = "auto"):
    return SimpleNamespace(
        llm_endpoint=llm_endpoint,
        llm_api_key="",
        llm_model_name="",
        openai_embedding_model="",
        ragas_engine=engine,
        internal_llm_enabled=lambda: bool(llm_endpoint.strip()),
    )


@pytest.fixture
def patch_settings(monkeypatch):
    def _apply(**kw):
        monkeypatch.setattr(rg, "get_settings", lambda: _settings(**kw))

    return _apply


def test_internal_gateway_set_picks_ragas_engine(patch_settings, monkeypatch):
    patch_settings(llm_endpoint="http://gw.internal/v1")
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    scorer = get_scorer(["faithfulness"])
    assert isinstance(scorer, RagasEngine)


def test_internal_gateway_unset_falls_back(patch_settings, monkeypatch):
    patch_settings()  # llm_endpoint=""
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)


def test_mode_fallback_forces_fallback(patch_settings, monkeypatch):
    patch_settings(llm_endpoint="http://gw.internal/v1", engine="fallback")
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)


def test_without_ragas_lib_falls_back(patch_settings, monkeypatch):
    patch_settings(llm_endpoint="http://gw.internal/v1")
    monkeypatch.setattr(rg, "ragas_importable", lambda: False)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)
