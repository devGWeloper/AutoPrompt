"""Engine-selection unit tests for app.services.ragas (no network).

Never calls RagasScorer.score() — only verifies provider auto-detection and
which scorer get_scorer() returns under each RAGAS_ENGINE mode.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.services.ragas as rg
from app.services.ragas import FallbackScorer, RagasEngine, get_scorer


def _settings(*, openai="", anthropic="", google="", engine="auto"):
    return SimpleNamespace(
        openai_api_key=openai,
        anthropic_api_key=anthropic,
        google_api_key=google,
        ragas_engine=engine,
    )


@pytest.fixture
def patch_settings(monkeypatch):
    def _apply(**kw):
        monkeypatch.setattr(rg, "get_settings", lambda: _settings(**kw))

    return _apply


def test_resolve_only_google(patch_settings):
    patch_settings(google="g-key")
    assert rg._resolve_judge_provider(None) == "google"


def test_resolve_no_keys(patch_settings):
    patch_settings()
    assert rg._resolve_judge_provider(None) is None


def test_resolve_explicit_missing_key_falls_back(patch_settings):
    # explicit openai but only google key configured -> google
    patch_settings(google="g-key")
    assert rg._resolve_judge_provider("openai") == "google"


def test_resolve_priority_prefers_openai(patch_settings):
    patch_settings(openai="o", google="g")
    assert rg._resolve_judge_provider(None) == "openai"


def test_mode_fallback_forces_fallback(patch_settings, monkeypatch):
    patch_settings(google="g-key", engine="fallback")
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)


def test_auto_with_ragas_and_key_picks_engine(patch_settings, monkeypatch):
    patch_settings(google="g-key", engine="auto")
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    scorer = get_scorer(["faithfulness"])
    assert isinstance(scorer, RagasEngine)
    assert scorer.judge_provider == "google"


def test_auto_without_ragas_lib_falls_back(patch_settings, monkeypatch):
    patch_settings(google="g-key", engine="auto")
    monkeypatch.setattr(rg, "ragas_importable", lambda: False)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)


def test_auto_without_any_key_falls_back(patch_settings, monkeypatch):
    patch_settings(engine="auto")
    monkeypatch.setattr(rg, "ragas_importable", lambda: True)
    assert isinstance(get_scorer(["faithfulness"]), FallbackScorer)
