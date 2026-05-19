from __future__ import annotations

import abc
from dataclasses import dataclass

# Canonical RAGAS metric names (spec §4.6.2). Order is significant for charts.
ALL_METRICS: tuple[str, ...] = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
    "answer_correctness",
)


@dataclass
class CaseScore:
    """Per-case metric scores. Unselected/failed metrics stay ``None``."""

    faithfulness: float | None = None
    answer_relevancy: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None
    answer_correctness: float | None = None

    def as_dict(self) -> dict[str, float | None]:
        return {m: getattr(self, m) for m in ALL_METRICS}


class RagasScorer(abc.ABC):
    """Common interface for RAGAS scoring backends.

    Mirrors the ``app.services.llm.LLMAdapter`` shape: an abstract async
    ``score`` plus an ``engine`` tag persisted on the run for traceability.
    """

    #: short identifier stored in PM_RAGAS_RUN.ENGINE ("RAGAS" | "FALLBACK")
    engine: str = "BASE"

    def __init__(self, metrics: list[str]) -> None:
        # Keep only known metrics, preserve canonical order.
        self.metrics = [m for m in ALL_METRICS if m in set(metrics)] or list(ALL_METRICS)

    @abc.abstractmethod
    async def score(
        self,
        *,
        question: str,
        answer: str,
        contexts: list[str],
        ground_truth: str | None,
    ) -> CaseScore:
        raise NotImplementedError
