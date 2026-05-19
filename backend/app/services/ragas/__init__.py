from __future__ import annotations

from app.core.config import get_settings
from app.services.ragas.base import ALL_METRICS, CaseScore, RagasScorer
from app.services.ragas.fallback_scorer import FallbackScorer
from app.services.ragas.ragas_engine import RagasEngine, ragas_importable

__all__ = [
    "ALL_METRICS",
    "CaseScore",
    "RagasScorer",
    "FallbackScorer",
    "RagasEngine",
    "get_scorer",
]

# Order of preference when no judge provider is explicitly requested.
_PROVIDER_PRIORITY = ("openai", "anthropic", "google")


def _resolve_judge_provider(explicit: str | None) -> str | None:
    """Pick the judge provider from configured keys.

    If ``explicit`` is given and its key is set, use it. Otherwise return the
    first provider in ``_PROVIDER_PRIORITY`` whose key is configured (so the
    key already in .env is used automatically). ``None`` if no key at all.
    """
    s = get_settings()
    keys = {
        "openai": s.openai_api_key,
        "anthropic": s.anthropic_api_key,
        "google": s.google_api_key,
    }
    if explicit:
        e = explicit.strip().lower()
        if keys.get(e):
            return e
    for provider in _PROVIDER_PRIORITY:
        if keys.get(provider):
            return provider
    return None


def get_scorer(
    metrics: list[str],
    *,
    judge_provider: str | None = None,
    judge_model: str | None = None,
) -> RagasScorer:
    """Pick the real ragas engine when usable, else the deterministic fallback.

    Controlled by ``Settings.ragas_engine`` (env ``RAGAS_ENGINE``):
    - ``fallback`` → always :class:`FallbackScorer`
    - ``auto`` (default) / ``ragas`` → real :class:`RagasEngine` when the
      ``ragas`` library is importable and a provider key is configured
      (auto-detected from .env), else fallback.
    """
    mode = (get_settings().ragas_engine or "auto").strip().lower()
    if mode == "fallback":
        return FallbackScorer(metrics)

    provider = _resolve_judge_provider(judge_provider)
    if ragas_importable() and provider:
        return RagasEngine(
            metrics, judge_provider=provider, judge_model=judge_model
        )
    return FallbackScorer(metrics)
