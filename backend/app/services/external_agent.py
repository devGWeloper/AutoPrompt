"""Adapter for calling the internal chat / super-agent service.

This is the piece that lets the prompt-management system drive the *real* model
for flow-level RAGAS evaluation, instead of only running internally.

The external model reads its per-node SYSTEM_PROMPT + USER_PROMPT directly from
the active ``PM_NODE_PROMPT_VER`` row in the shared Oracle DB — so the chat
request itself only carries the user message + a user id. For A/B comparison,
``flow_service`` temporarily flips the active flag before invoking this adapter.

Contract:
    POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}
    request:  {"message": "<test input>", "user_id": "pm-test"}
    response: {"response": "<answer>", "docs": [...], "urls": [...], ...}
The other response fields (service_id / session_id / user_id / trace_id / urls /
images / db_data / followup_questions / knowhows) are intentionally ignored.
"""
from __future__ import annotations

import httpx

from app.core.config import get_settings


class ExternalAgentError(RuntimeError):
    """An external chat call failed or is misconfigured."""


def external_enabled() -> bool:
    """True when run_mode=external AND a base URL is configured."""
    s = get_settings()
    return s.run_mode.strip().lower() == "external" and bool(s.external_agent_base_url.strip())


def _base_url() -> str:
    url = get_settings().external_agent_base_url.strip().rstrip("/")
    if not url:
        raise ExternalAgentError("EXTERNAL_AGENT_BASE_URL is not set (.env)")
    return url


def _normalize_docs(raw: object) -> list[str]:
    """Coerce the response ``docs`` field into a list[str] (skip non-strings)."""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for d in raw:
        if isinstance(d, str):
            out.append(d)
        elif isinstance(d, dict):
            # tolerate {"content": "..."} / {"text": "..."} shapes
            for k in ("content", "text", "body"):
                v = d.get(k)
                if isinstance(v, str) and v:
                    out.append(v)
                    break
    return out


async def run_flow(*, message: str, timeout_s: float = 60.0) -> dict:
    """POST one turn to the external chat endpoint and return ``{response, docs}``.

    The external model resolves its SYSTEM_PROMPT/USER_PROMPT from the active
    PM_NODE_PROMPT_VER row by itself — see module docstring.
    """
    s = get_settings()
    path = s.external_chat_path
    if not path.startswith("/"):
        path = "/" + path
    payload = {"message": message, "user_id": s.external_user_id}
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(f"{_base_url()}{path}", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise ExternalAgentError(f"chat run failed: {exc}") from exc
    if not isinstance(data, dict):
        raise ExternalAgentError(f"unexpected chat response shape: {type(data).__name__}")
    return {
        "response": str(data.get("response") or ""),
        "docs": _normalize_docs(data.get("docs")),
    }


async def stub_run_flow(*, message: str, **_: object) -> dict:
    """TEMPORARY in-process stand-in for ``run_flow`` (no external endpoint yet).

    Returns a deterministic placeholder answer in the same shape as ``run_flow``
    so flow-level RAGAS runs end-to-end while the real chat/super-agent is not
    connected. Swap by setting ``RUN_MODE=external`` + ``EXTERNAL_AGENT_BASE_URL``.
    """
    return {"response": f"[stub answer] {message}".strip(), "docs": []}


async def flow_answer(*, message: str) -> dict:
    """One flow answer: the real chat endpoint when external is enabled, else the stub."""
    if external_enabled():
        return await run_flow(message=message)
    return await stub_run_flow(message=message)
