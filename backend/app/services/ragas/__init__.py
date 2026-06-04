from __future__ import annotations

import logging

from app.core.config import get_settings
from app.services.ragas.base import ALL_METRICS, CaseScore, RagasScorer
from app.services.ragas.fallback_scorer import FallbackScorer
from app.services.ragas.ragas_engine import RagasEngine, ragas_importable

logger = logging.getLogger(__name__)

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
    importable = ragas_importable()
    llm_on = s.internal_llm_enabled()
    if importable and llm_on:
        return RagasEngine(metrics, judge_model=judge_model)
    # mode is "auto"/"ragas" but the real engine can't run — say why, since the
    # symptom ("engine stays FALLBACK") otherwise looks like the LLM was ignored.
    logger.warning(
        "RAGAS_ENGINE=%s but falling back to FALLBACK scorer "
        "(ragas_importable=%s, LLM_ENDPOINT set=%s). "
        "Real RAGAS needs both: a usable ragas install AND LLM_ENDPOINT configured.",
        mode, importable, llm_on,
    )
    return FallbackScorer(metrics)
