from __future__ import annotations

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


# Default judge model per provider when the caller doesn't pin one.
_DEFAULT_MODEL = {
    "google": "gemini-2-flash",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
}


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
        model = self.judge_model or _DEFAULT_MODEL.get(provider)

        if provider == "google":
            from langchain_google_genai import (  # type: ignore[import-not-found]
                ChatGoogleGenerativeAI,
                GoogleGenerativeAIEmbeddings,
            )

            llm = ChatGoogleGenerativeAI(
                model=model or "gemini-1.5-flash",
                google_api_key=s.google_api_key,
                temperature=0,
            )
            emb = GoogleGenerativeAIEmbeddings(
                model="models/embedding-001",
                google_api_key=s.google_api_key,
            )
        elif provider == "openai":
            from langchain_openai import (  # type: ignore[import-not-found]
                ChatOpenAI,
                OpenAIEmbeddings,
            )

            llm = ChatOpenAI(
                model=model or "gpt-4o-mini",
                api_key=s.openai_api_key,
                temperature=0,
            )
            emb = OpenAIEmbeddings(api_key=s.openai_api_key)
        elif provider == "anthropic":
            from langchain_anthropic import ChatAnthropic  # type: ignore[import-not-found]

            llm = ChatAnthropic(
                model=model or "claude-3-5-haiku-latest",
                api_key=s.anthropic_api_key,
                temperature=0,
            )
            # Anthropic has no embeddings; reuse OpenAI if its key is set.
            if not s.openai_api_key:
                raise RagasUnavailable(
                    "anthropic judge needs an embeddings provider "
                    "(set OPENAI_API_KEY or use google)"
                )
            from langchain_openai import OpenAIEmbeddings  # type: ignore[import-not-found]

            emb = OpenAIEmbeddings(api_key=s.openai_api_key)
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
            try:
                return round(float(v), 4) if v is not None else None
            except (TypeError, ValueError):
                return None

        return CaseScore(**{m: _g(m) for m in self.metrics})
