from __future__ import annotations

from app.core.config import get_settings
from app.services.llm.anthropic_adapter import AnthropicAdapter
from app.services.llm.base import InvocationResult, LLMAdapter, render_template
from app.services.llm.google_adapter import GoogleAdapter
from app.services.llm.openai_adapter import OpenAIAdapter

__all__ = ["InvocationResult", "LLMAdapter", "render_template", "get_adapter"]

_ADAPTERS: dict[str, type[LLMAdapter]] = {
    "anthropic": AnthropicAdapter,
    "openai": OpenAIAdapter,
    "google": GoogleAdapter,
}


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
