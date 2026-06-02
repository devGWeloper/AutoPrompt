"""Adapter for calling the internal chat / super-agent service.

This is the piece that lets the prompt-management system drive the *real* model
for flow-level RAGAS evaluation, instead of only running internally.

- ``run_flow()`` POSTs one turn to the model's chat endpoint (``EXTERNAL_CHAT_PATH``)
  with the managed prompt in ``session_system_prompt`` and the test input in
  ``message``; it returns the model's answer.
- ``retrieve()`` (``/retrieve``) is only used if the model exposes a RAG endpoint
  for RAGAS grounding.

Wiring (which services call this, gated on ``RUN_MODE=external``) is applied
per the ``connect-prompt-mgmt`` skill after the contract is confirmed; the wire
format lives in that skill's ``references/02-api-contract.md``.
"""
from __future__ import annotations

from uuid import uuid4

import httpx

from app.core.config import get_settings


class ExternalAgentError(RuntimeError):
    """An external LangGraph service call failed or is misconfigured."""


def external_enabled() -> bool:
    """True when run_mode=external AND a base URL is configured."""
    s = get_settings()
    return s.run_mode.strip().lower() == "external" and bool(s.external_agent_base_url.strip())


def _base_url() -> str:
    url = get_settings().external_agent_base_url.strip().rstrip("/")
    if not url:
        raise ExternalAgentError("EXTERNAL_AGENT_BASE_URL is not set (.env)")
    return url


# Response keys the internal model might use for the assistant's answer, in order
# of preference. >>> FILL IN: pin the model's actual field if it isn't one of these.
_ANSWER_KEYS = ("output", "answer", "response", "message", "content", "result", "text")


def _extract_answer(data: object) -> str:
    """Pull the assistant answer from the chat response (tolerant of field name)."""
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for k in _ANSWER_KEYS:
            v = data.get(k)
            if isinstance(v, str) and v:
                return v
        # nested {"data": {...}} / {"message": {"content": ...}} shapes
        for k in ("data", "message", "result"):
            inner = data.get(k)
            if isinstance(inner, dict):
                nested = _extract_answer(inner)
                if nested:
                    return nested
        # >>> FILL IN: map the model's real answer field; until then, echo raw JSON.
        import json

        return json.dumps(data, ensure_ascii=False)
    return str(data)


def _a2a_remote_urls() -> object:
    raw = get_settings().external_a2a_remote_urls
    if not raw:
        return None
    return [u.strip() for u in raw.split(",") if u.strip()]


async def run_flow(
    *,
    message: str,
    session_system_prompt: str | None = None,
    main_model_name: str | None = None,
    session_id: str | None = None,
    timeout_s: float = 60.0,
) -> dict:
    """Run one turn against the internal chat / super-agent endpoint.

    Used by flow-level RAGAS. The managed prompt rides in ``session_system_prompt``;
    the test input is ``message``. Contract:

        POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}
        request:  {
            "message": "<test input>",
            "user_id": "pm-test",
            "session_id": "<uuid>",
            "chat_type": "default",
            "a2a_remote_urls": null,
            "is_super_agent": null,
            "main_model_name": "<flow main model>",
            "session_system_prompt": "<managed SYSTEM_PROMPT>"
        }
        response: {"output": "<answer>"}   # >>> FILL IN: real answer field (see _ANSWER_KEYS)

    Returns ``{"output": "<answer>"}`` (single-turn — no per-node trace).
    """
    s = get_settings()
    path = s.external_chat_path
    if not path.startswith("/"):
        path = "/" + path
    payload = {
        "message": message,
        "user_id": s.external_user_id,
        "session_id": session_id or uuid4().hex,
        "chat_type": s.external_chat_type,
        "a2a_remote_urls": _a2a_remote_urls(),
        "is_super_agent": s.external_is_super_agent,
        "main_model_name": main_model_name,
        "session_system_prompt": session_system_prompt or "",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(f"{_base_url()}{path}", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise ExternalAgentError(f"chat run failed: {exc}") from exc
    return {"output": _extract_answer(data)}


async def stub_run_flow(*, message: str, **_: object) -> dict:
    """TEMPORARY in-process stand-in for ``run_flow`` (no external endpoint yet).

    Returns a deterministic placeholder answer so flow-level RAGAS runs end-to-end
    while the real chat/super-agent is not connected. Swap back to the real call by
    setting ``RUN_MODE=external`` + ``EXTERNAL_AGENT_BASE_URL`` (see ``flow_answer``).
    """
    return {"output": f"[stub answer] {message}".strip()}


async def flow_answer(
    *,
    message: str,
    session_system_prompt: str | None = None,
    main_model_name: str | None = None,
) -> dict:
    """One flow answer: the real chat endpoint when external is enabled, else the stub."""
    if external_enabled():
        return await run_flow(
            message=message,
            session_system_prompt=session_system_prompt,
            main_model_name=main_model_name,
        )
    return await stub_run_flow(message=message)


async def retrieve(query: str, *, top_k: int = 5, timeout_s: float = 30.0) -> list[str]:
    """Fetch RAG contexts from the external retriever -> ``{"contexts": [str,...]}``."""
    payload = {"query": query, "top_k": top_k}
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(f"{_base_url()}/retrieve", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise ExternalAgentError(f"retrieve failed: {exc}") from exc
    ctxs = data.get("contexts", [])
    return [str(c) for c in ctxs] if isinstance(ctxs, list) else []
