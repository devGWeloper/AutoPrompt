from __future__ import annotations

import time

from app.services.llm.base import InvocationResult, LLMAdapter, render_template


class GoogleAdapter(LLMAdapter):
    async def invoke(
        self,
        *,
        system_prompt: str | None,
        user_prompt: str | None,
        variables: dict[str, str],
    ) -> InvocationResult:
        import google.generativeai as genai

        genai.configure(api_key=self.extra_params.get("_api_key", ""))
        system = render_template(system_prompt, variables)
        user = render_template(user_prompt, variables)

        gen_config: dict = {}
        if self.temperature is not None:
            gen_config["temperature"] = self.temperature
        if self.max_tokens is not None:
            gen_config["max_output_tokens"] = self.max_tokens
        if self.top_p is not None:
            gen_config["top_p"] = self.top_p

        model = genai.GenerativeModel(
            self.model,
            system_instruction=system or None,
            generation_config=gen_config or None,  # type: ignore[arg-type]
        )

        started = time.perf_counter()
        resp = await model.generate_content_async(user)
        latency_ms = int((time.perf_counter() - started) * 1000)

        usage = getattr(resp, "usage_metadata", None)
        return InvocationResult(
            output=resp.text,
            input_tokens=getattr(usage, "prompt_token_count", 0) if usage else 0,
            output_tokens=getattr(usage, "candidates_token_count", 0) if usage else 0,
            latency_ms=latency_ms,
            model=self.model,
        )
