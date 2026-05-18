from __future__ import annotations

import time

from app.services.llm.base import InvocationResult, LLMAdapter, render_template


class AnthropicAdapter(LLMAdapter):
    async def invoke(
        self,
        *,
        system_prompt: str | None,
        user_prompt: str | None,
        variables: dict[str, str],
    ) -> InvocationResult:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=self.extra_params.get("_api_key", ""))
        system = render_template(system_prompt, variables)
        user = render_template(user_prompt, variables)

        kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens or 2048,
            "messages": [{"role": "user", "content": user}],
        }
        if system:
            kwargs["system"] = system
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if self.top_p is not None:
            kwargs["top_p"] = self.top_p

        started = time.perf_counter()
        resp = await client.messages.create(**kwargs)
        latency_ms = int((time.perf_counter() - started) * 1000)

        text = "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        )
        return InvocationResult(
            output=text,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            latency_ms=latency_ms,
            model=self.model,
        )
