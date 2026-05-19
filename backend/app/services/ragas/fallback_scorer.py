from __future__ import annotations

import re

from app.services.ragas.base import CaseScore, RagasScorer

_WORD = re.compile(r"[a-z0-9가-힣]+")


def _tokens(text: str | None) -> set[str]:
    return set(_WORD.findall((text or "").lower()))


def _coverage(a: str | None, b: str | None) -> float:
    """Fraction of a's unique tokens that also appear in b."""
    ta = _tokens(a)
    if not ta:
        return 0.0
    tb = _tokens(b)
    return round(len(ta & tb) / len(ta), 4)


def _jaccard(a: str | None, b: str | None) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta and not tb:
        return 0.0
    union = ta | tb
    return round(len(ta & tb) / len(union), 4) if union else 0.0


class FallbackScorer(RagasScorer):
    """Deterministic, dependency-free token-overlap heuristics.

    Used whenever the real ``ragas`` library or a judge LLM key is
    unavailable, so a RAGAS run is always executable and reproducible.
    """

    engine = "FALLBACK"

    async def score(
        self,
        *,
        question: str,
        answer: str,
        contexts: list[str],
        ground_truth: str | None,
    ) -> CaseScore:
        ctx = "\n".join(contexts)
        gt = ground_truth or ""
        computed = {
            "faithfulness": _coverage(answer, ctx),
            "answer_relevancy": _jaccard(answer, question),
            "context_precision": _coverage(ctx, gt) if gt else None,
            "context_recall": _coverage(gt, ctx) if gt else None,
            "answer_correctness": _jaccard(answer, gt) if gt else None,
        }
        return CaseScore(**{m: computed[m] for m in self.metrics})
