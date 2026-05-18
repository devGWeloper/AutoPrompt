from __future__ import annotations

import time

from app.services.llm.base import InvocationResult, LLMAdapter, render_template


class OpenAIAdapter(LLMAdapter):
    async def invoke(
        self,
        *,
        system_prompt: str | None,
        user_prompt: str | None,
        variables: dict[str, str],
    ) -> InvocationResult:
        import openai

        client = openai.AsyncOpenAI(api_key=self.extra_params.get("_api_key", ""))
        system = render_template(system_prompt, variables)
        user = render_template(user_prompt, variables)

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})

        kwargs: dict = {"model": self.model, "messages": messages}
        if self.max_tokens is not None:
            kwargs["max_tokens"] = self.max_tokens
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if self.top_p is not None:
            kwargs["top_p"] = self.top_p

        started = time.perf_counter()
        resp = await client.chat.completions.create(**kwargs)
        latency_ms = int((time.perf_counter() - started) * 1000)

        usage = resp.usage
        return InvocationResult(
            output=resp.choices[0].message.content or "",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
            model=self.model,
        )
