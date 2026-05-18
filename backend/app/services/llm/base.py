from __future__ import annotations

import abc

from pydantic import BaseModel

from app.services.variable_parser import _VAR_PATTERN


class InvocationResult(BaseModel):
    """Normalized result of a single LLM invocation."""

    output: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    model: str


def render_template(text: str | None, variables: dict[str, str]) -> str:
    """Replace {{var}} placeholders with values; unknown vars become empty string."""
    if not text:
        return ""

    def _sub(match: object) -> str:
        name = match.group(1)  # type: ignore[attr-defined]
        return str(variables.get(name, ""))

    return _VAR_PATTERN.sub(_sub, text)


class LLMAdapter(abc.ABC):
    """Common interface for all LLM provider adapters."""

    def __init__(
        self,
        *,
        model: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        extra_params: dict | None = None,
    ) -> None:
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.extra_params = extra_params or {}

    @abc.abstractmethod
    async def invoke(
        self,
        *,
        system_prompt: str | None,
        user_prompt: str | None,
        variables: dict[str, str],
    ) -> InvocationResult:
        """Render the prompts with variables, call the provider, return normalized result."""
        raise NotImplementedError
