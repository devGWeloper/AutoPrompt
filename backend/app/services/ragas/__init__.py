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


def get_scorer(
    metrics: list[str],
    *,
    judge_provider: str | None = None,  # legacy param: ignored (single internal gateway)
    judge_model: str | None = None,
) -> RagasScorer:
    """Pick the real ragas engine when usable, else the deterministic fallback.

    Controlled by ``Settings.ragas_engine`` (env ``RAGAS_ENGINE``):
    - ``fallback`` → always :class:`FallbackScorer`
    - ``auto`` (default) / ``ragas`` → real :class:`RagasEngine` when the
      ``ragas`` library is importable and the internal LLM gateway is configured
      (``LLM_ENDPOINT`` set), else fallback.
    """
    s = get_settings()
    mode = (s.ragas_engine or "auto").strip().lower()
    if mode == "fallback":
        return FallbackScorer(metrics)
    if ragas_importable() and s.internal_llm_enabled():
        return RagasEngine(metrics, judge_model=judge_model)
    return FallbackScorer(metrics)
