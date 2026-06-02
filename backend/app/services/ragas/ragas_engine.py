from __future__ import annotations

import math

from app.core.config import get_settings
from app.services.ragas.base import CaseScore, RagasScorer


class RagasUnavailable(RuntimeError):
    """Raised when the real ragas library cannot be used in this environment."""


def ragas_importable() -> bool:
    try:
        import ragas  # noqa: F401
    except Exception:  # noqa: BLE001 - any import/runtime issue means "unavailable"
        return False
    return True


class RagasEngine(RagasScorer):
    """Adapter over the real ``ragas`` library (optional dependency).

    Builds a Langchain LLM from the internal OpenAI-compatible LLM gateway
    (LLM_ENDPOINT / LLM_API_KEY / LLM_MODEL_NAME) and embeddings from a separate
    OpenAI-compatible embedding endpoint (EMBEDDING_ENDPOINT / EMBEDDING_API_KEY
    / EMBEDDING_MODEL_NAME), then evaluates one case at a time. Any failure
    raises :class:`RagasUnavailable` so ``ragas_service`` records it per-case
    while the run still completes.
    """

    engine = "RAGAS"

    def __init__(self, metrics: list[str], *, judge_model: str | None = None) -> None:
        super().__init__(metrics)
        self.judge_model = judge_model
        self._wrapped: tuple[object, object] | None = None  # (llm, embeddings)

    # -- judge construction -------------------------------------------------

    def _build_judge(self) -> tuple[object, object]:
        """Return ragas-wrapped (llm, embeddings). LLM goes through the internal
        gateway (LLM_*); embeddings go through their own EMBEDDING_* gateway
        (may be the same host or a different one)."""
        s = get_settings()
        if not s.internal_llm_enabled():
            raise RagasUnavailable("LLM_ENDPOINT is not set (.env)")

        from langchain_openai import (  # type: ignore[import-not-found]
            ChatOpenAI,
            OpenAIEmbeddings,
        )

        model = self.judge_model or s.llm_model_name
        if not model:
            raise RagasUnavailable("no judge model (set LLM_MODEL_NAME)")
        llm = ChatOpenAI(
            model=model,
            api_key=s.llm_api_key,
            base_url=s.llm_endpoint,
            temperature=0,
        )
        if not s.embedding_endpoint.strip():
            raise RagasUnavailable("EMBEDDING_ENDPOINT is not set (.env)")
        if not s.embedding_model_name.strip():
            raise RagasUnavailable("EMBEDDING_MODEL_NAME is not set (.env)")
        emb = OpenAIEmbeddings(
            model=s.embedding_model_name,
            api_key=s.embedding_api_key,
            base_url=s.embedding_endpoint,
        )

        try:
            from ragas.embeddings import (  # type: ignore[import-not-found]
                LangchainEmbeddingsWrapper,
            )
            from ragas.llms import LangchainLLMWrapper  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001 - ragas version mismatch
            raise RagasUnavailable(str(exc)) from exc

        return LangchainLLMWrapper(llm), LangchainEmbeddingsWrapper(emb)

    def _judge(self) -> tuple[object, object]:
        if self._wrapped is None:
            self._wrapped = self._build_judge()
        return self._wrapped

    # -- metrics ------------------------------------------------------------

    def _metric_objs(self) -> list[object]:
        from ragas import metrics as rm  # type: ignore[import-not-found]

        objs: list[object] = []
        for m in self.metrics:
            obj = getattr(rm, m, None)
            if obj is not None:
                objs.append(obj)
        return objs

    # -- scoring ------------------------------------------------------------

    async def score(
        self,
        *,
        question: str,
        answer: str,
        contexts: list[str],
        ground_truth: str | None,
    ) -> CaseScore:
        try:
            from datasets import Dataset  # type: ignore[import-not-found]
            from ragas import evaluate  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001
            raise RagasUnavailable(str(exc)) from exc

        llm, emb = self._judge()

        row = {
            "question": [question],
            "answer": [answer],
            "contexts": [contexts or [""]],
            "ground_truth": [ground_truth or ""],
        }
        try:
            ds = Dataset.from_dict(row)
            result = evaluate(
                ds,
                metrics=self._metric_objs(),
                llm=llm,
                embeddings=emb,
            )
            scores = result.to_pandas().iloc[0].to_dict()
        except Exception as exc:  # noqa: BLE001 - provider/judge/runtime failure
            raise RagasUnavailable(str(exc)) from exc

        def _g(name: str) -> float | None:
            v = scores.get(name)
            if v is None:
                return None
            try:
                f = float(v)
            except (TypeError, ValueError):
                return None
            # ragas yields NaN when a metric can't be computed; treat as "no score".
            if not math.isfinite(f):
                return None
            return round(f, 4)

        return CaseScore(**{m: _g(m) for m in self.metrics})
