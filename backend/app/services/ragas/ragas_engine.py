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

    Builds a Langchain LLM + embeddings from the resolved judge provider using
    the API key already in settings/.env, then evaluates one case at a time.
    Any failure raises :class:`RagasUnavailable` so ``ragas_service`` records
    it per-case while the run still completes.
    """

    engine = "RAGAS"

    def __init__(
        self,
        metrics: list[str],
        *,
        judge_provider: str | None,
        judge_model: str | None,
    ) -> None:
        super().__init__(metrics)
        self.judge_provider = (judge_provider or "").strip().lower()
        self.judge_model = judge_model
        self._wrapped: tuple[object, object] | None = None  # (llm, embeddings)

    # -- judge construction -------------------------------------------------

    def _build_judge(self) -> tuple[object, object]:
        """Return ragas-wrapped (llm, embeddings) for the judge provider."""
        s = get_settings()
        provider = self.judge_provider

        if provider == "google":
            from langchain_google_genai import (  # type: ignore[import-not-found]
                ChatGoogleGenerativeAI,
                GoogleGenerativeAIEmbeddings,
            )

            model = self.judge_model or s.google_judge_model
            if not model:
                raise RagasUnavailable("GOOGLE_JUDGE_MODEL is not set (.env)")
            llm = ChatGoogleGenerativeAI(
                model=model,
                google_api_key=s.google_api_key,
                temperature=0,
            )
            if not s.google_embedding_model:
                raise RagasUnavailable("GOOGLE_EMBEDDING_MODEL is not set (.env)")
            emb = GoogleGenerativeAIEmbeddings(
                model=s.google_embedding_model,
                google_api_key=s.google_api_key,
            )
        elif provider == "openai":
            from langchain_openai import (  # type: ignore[import-not-found]
                ChatOpenAI,
                OpenAIEmbeddings,
            )

            # Route to the internal OpenAI-compatible gateway when configured.
            internal = s.internal_llm_enabled()
            base_url = (s.llm_endpoint or None) if internal else None
            api_key = s.llm_api_key if internal else s.openai_api_key
            model = self.judge_model or (s.llm_model_name if internal else s.openai_judge_model)
            if not model:
                raise RagasUnavailable("no judge model (set LLM_MODEL_NAME or OPENAI_JUDGE_MODEL)")
            llm = ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=0)
            if not s.openai_embedding_model:
                raise RagasUnavailable("OPENAI_EMBEDDING_MODEL is not set (.env)")
            emb = OpenAIEmbeddings(
                model=s.openai_embedding_model, api_key=api_key, base_url=base_url
            )
        elif provider == "anthropic":
            from langchain_anthropic import ChatAnthropic  # type: ignore[import-not-found]

            model = self.judge_model or s.anthropic_judge_model
            if not model:
                raise RagasUnavailable("ANTHROPIC_JUDGE_MODEL is not set (.env)")
            llm = ChatAnthropic(
                model=model,
                api_key=s.anthropic_api_key,
                temperature=0,
            )
            # Anthropic has no embeddings; reuse OpenAI if its key is set.
            if not s.openai_api_key:
                raise RagasUnavailable(
                    "anthropic judge needs an embeddings provider "
                    "(set OPENAI_API_KEY or use google)"
                )
            if not s.openai_embedding_model:
                raise RagasUnavailable("OPENAI_EMBEDDING_MODEL is not set (.env)")
            from langchain_openai import OpenAIEmbeddings  # type: ignore[import-not-found]

            emb = OpenAIEmbeddings(model=s.openai_embedding_model, api_key=s.openai_api_key)
        else:
            raise RagasUnavailable(f"unsupported judge provider: {provider!r}")

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
