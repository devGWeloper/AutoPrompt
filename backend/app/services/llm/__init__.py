from __future__ import annotations

from app.core.config import get_settings
from app.services.llm.anthropic_adapter import AnthropicAdapter
from app.services.llm.base import InvocationResult, LLMAdapter, render_template
from app.services.llm.google_adapter import GoogleAdapter
from app.services.llm.openai_adapter import OpenAIAdapter

__all__ = [
    "InvocationResult",
    "LLMAdapter",
    "render_template",
    "get_adapter",
    "provider_for_model",
]

_ADAPTERS: dict[str, type[LLMAdapter]] = {
    "anthropic": AnthropicAdapter,
    "openai": OpenAIAdapter,
    "google": GoogleAdapter,
}

# NODE_MAS / CHAT_VER_MAS store only a model NAME (no provider). Infer the
# provider from the model name so internal node tests / RAGAS can pick an adapter.
# >>> FILL IN: extend the prefixes if the operational project uses other models.
_MODEL_PREFIX_PROVIDER: list[tuple[tuple[str, ...], str]] = [
    (("claude", "anthropic"), "anthropic"),
    (("gpt", "o1", "o3", "o4", "text-", "openai", "davinci"), "openai"),
    (("gemini", "models/", "google", "text-embedding-004"), "google"),
]


def provider_for_model(model: str | None) -> str:
    """Best-effort provider inference from a model name (NODE_MAS has no provider)."""
    name = (model or "").strip().lower()
    for prefixes, provider in _MODEL_PREFIX_PROVIDER:
        if any(name.startswith(p) for p in prefixes):
            return provider
    raise RuntimeError(
        f"cannot infer provider for model {model!r}; add it to "
        "app.services.llm._MODEL_PREFIX_PROVIDER"
    )


def get_adapter(
    provider: str,
    model: str,
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    extra_params: dict | None = None,
) -> LLMAdapter:
    """Build the adapter for ``provider``, injecting the configured API key.

    Raises RuntimeError for an unknown provider or a missing API key.
    """
    key = provider.strip().lower()
    adapter_cls = _ADAPTERS.get(key)
    if adapter_cls is None:
        raise RuntimeError(f"unsupported model provider: {provider!r}")

    settings = get_settings()
    api_key = {
        "anthropic": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "google": settings.google_api_key,
    }[key]
    if not api_key:
        raise RuntimeError(f"{key.upper()}_API_KEY is not configured")

    params = dict(extra_params or {})
    params["_api_key"] = api_key
    return adapter_cls(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        extra_params=params,
    )
