from __future__ import annotations

import re

from app.services.ragas.base import CaseScore, RagasScorer

_WORD = re.compile(r"[a-z0-9가-힣]+")

# Common Korean particles (josa) and a few endings that attach to a stem. The
# token heuristics compare surface forms, so without this "프롬프트를" / "프롬프트는"
# / "프롬프트" count as three different words and Korean answers score far too low.
# We strip a single trailing particle so they collapse to one stem. Ordered
# longest-first so the longest matching particle is removed.
_JOSA = (
    "으로써", "으로서", "이라고", "에게서", "으로", "로서", "로써", "이라", "라고", "에서",
    "에게", "께서", "라는", "이나", "에는", "에도", "이다", "처럼", "보다", "까지", "부터",
    "마저", "조차", "한테", "은", "는", "이", "가", "을", "를", "과", "와", "의", "에",
    "도", "만", "로", "랑", "나", "야",
)


def _strip_josa(tok: str) -> str:
    """Drop one trailing Korean particle, keeping the stem. Only Hangul-suffixed
    tokens can match (so pure latin/digit tokens fall through untouched), and we
    require ≥2 stem chars so a 1-char word is never nuked. This also normalises
    mixed tokens like "AutoPrompt를" / "RAGAS는" → "autoprompt" / "ragas"."""
    for j in _JOSA:
        if len(tok) >= len(j) + 2 and tok.endswith(j):
            return tok[: -len(j)]
    return tok


def _tokens(text: str | None) -> set[str]:
    return {_strip_josa(t) for t in _WORD.findall((text or "").lower())}


def _coverage(a: str | None, b: str | None) -> float:
    """Fraction of a's unique tokens that also appear in b (recall of a in b)."""
    ta = _tokens(a)
    if not ta:
        return 0.0
    tb = _tokens(b)
    return round(len(ta & tb) / len(ta), 4)


def _f1(a: str | None, b: str | None) -> float:
    """Token-overlap F1 (harmonic mean of precision & recall). Symmetric and
    far less punishing than Jaccard when the two texts differ in length."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    if inter == 0:
        return 0.0
    return round(2 * inter / (len(ta) + len(tb)), 4)


class FallbackScorer(RagasScorer):
    """Deterministic, dependency-free token-overlap heuristics.

    Used whenever the real ``ragas`` library or a judge LLM key is
    unavailable, so a RAGAS run is always executable and reproducible. These are
    lexical approximations, not semantic judgements: they reward word overlap
    after light Korean particle normalisation, so paraphrases/synonyms still
    score lower than a real LLM judge would give.
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
            # How much of the answer is grounded in the retrieved context.
            "faithfulness": _coverage(answer, ctx),
            # How much of the question the answer actually addresses. Coverage
            # (not Jaccard) so a long, thorough answer isn't penalised for length.
            "answer_relevancy": _coverage(question, answer),
            # How much of the retrieved context is relevant to the ground truth.
            "context_precision": _coverage(ctx, gt) if gt else None,
            # How much of the ground truth is covered by the retrieved context.
            "context_recall": _coverage(gt, ctx) if gt else None,
            # Agreement between answer and ground truth — F1 balances precision
            # and recall instead of the harsher Jaccard.
            "answer_correctness": _f1(answer, gt) if gt else None,
        }
        return CaseScore(**{m: computed[m] for m in self.metrics})
