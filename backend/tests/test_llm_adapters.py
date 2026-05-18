from __future__ import annotations

from app.services.llm.anthropic_adapter import AnthropicAdapter
from app.services.llm.base import render_template
from app.services.llm.google_adapter import GoogleAdapter
from app.services.llm.openai_adapter import OpenAIAdapter


def test_render_template_substitutes_and_blanks_unknown():
    out = render_template("Hi {{name}}, age {{age}}", {"name": "Sam"})
    assert out == "Hi Sam, age "


async def test_anthropic_adapter_maps_result(monkeypatch):
    import anthropic

    captured: dict = {}

    class _Blk:
        type = "text"
        text = "answer"

    class _Usage:
        input_tokens = 11
        output_tokens = 7

    class _Resp:
        content = [_Blk()]
        usage = _Usage()

    class _Messages:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _Resp()

    class _Client:
        def __init__(self, **kwargs):
            self.messages = _Messages()

    monkeypatch.setattr(anthropic, "AsyncAnthropic", _Client)

    adapter = AnthropicAdapter(model="claude-x", max_tokens=128, extra_params={"_api_key": "k"})
    result = await adapter.invoke(
        system_prompt="sys", user_prompt="Q: {{q}}", variables={"q": "hi"}
    )

    assert result.output == "answer"
    assert result.input_tokens == 11
    assert result.output_tokens == 7
    assert result.model == "claude-x"
    assert captured["messages"] == [{"role": "user", "content": "Q: hi"}]
    assert captured["system"] == "sys"


async def test_openai_adapter_maps_result(monkeypatch):
    import openai

    captured: dict = {}

    class _Msg:
        content = "hello"

    class _Choice:
        message = _Msg()

    class _Usage:
        prompt_tokens = 4
        completion_tokens = 9

    class _Resp:
        choices = [_Choice()]
        usage = _Usage()

    class _Completions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        def __init__(self, **kwargs):
            self.chat = _Chat()

    monkeypatch.setattr(openai, "AsyncOpenAI", _Client)

    adapter = OpenAIAdapter(model="gpt-x", temperature=0.5, extra_params={"_api_key": "k"})
    result = await adapter.invoke(
        system_prompt="S", user_prompt="ask {{name}}", variables={"name": "Ann"}
    )

    assert result.output == "hello"
    assert result.input_tokens == 4
    assert result.output_tokens == 9
    assert captured["messages"][-1] == {"role": "user", "content": "ask Ann"}


async def test_google_adapter_maps_result(monkeypatch):
    import google.generativeai as genai

    captured: dict = {}

    class _Usage:
        prompt_token_count = 6
        candidates_token_count = 2

    class _Resp:
        text = "gemini-out"
        usage_metadata = _Usage()

    class _Model:
        def __init__(self, name, system_instruction=None, generation_config=None):
            captured["name"] = name
            captured["system_instruction"] = system_instruction

        async def generate_content_async(self, user):
            captured["user"] = user
            return _Resp()

    monkeypatch.setattr(genai, "configure", lambda **kwargs: None)
    monkeypatch.setattr(genai, "GenerativeModel", _Model)

    adapter = GoogleAdapter(model="gemini-1.5", extra_params={"_api_key": "k"})
    result = await adapter.invoke(
        system_prompt="sys", user_prompt="hi {{who}}", variables={"who": "there"}
    )

    assert result.output == "gemini-out"
    assert result.input_tokens == 6
    assert result.output_tokens == 2
    assert captured["user"] == "hi there"
    assert captured["system_instruction"] == "sys"
