"""Adapter for calling the internal chat / super-agent service.

This is the piece that lets the prompt-management system drive the *real* model
for flow-level RAGAS evaluation, instead of only running internally.

The external model reads its per-node SYSTEM_PROMPT + USER_PROMPT directly from
the active ``PM_NODE_PROMPT_VER`` row in the shared Oracle DB — so the chat
request itself only carries the user message + a user id. For A/B comparison,
``flow_service`` temporarily flips the active flag before invoking this adapter.

Contract:
    POST {EXTERNAL_AGENT_BASE_URL}
    headers:  {EXTERNAL_AUTH_HEADER|"auth-key"}: {EXTERNAL_AUTH_KEY}
              {EXTERNAL_USER_HEADER|"user-id"}:  {EXTERNAL_USER_ID}
    request:  {"message": "<test input>", "user_id": "pm-test"}
    response: {"response": "<answer>", "docs": [...], "urls": [...], ...}
The other response fields (service_id / session_id / user_id / trace_id / urls /
images / db_data / followup_questions / knowhows) are intentionally ignored.
"""
from __future__ import annotations

import json

import httpx

from app.core.config import get_settings

# Hardcoded session context sent as ``session_system_prompt``. The agent's field
# is a STRING, so this is a *stringified* JSON object (json.dumps keeps the
# embedded quotes valid); the agent json.loads it to read CUBE_CHANNEL_ID & co.
_SESSION_SYSTEM_PROMPT = json.dumps(
    {
        "CUBE_CHANNEL_ID": "509108549",
        "CUBE_USER_ID": "2074340",
        "CUBE_USER_NM": "김태윤",
        "TRACE_ID": "AI-20260416-171758-44399577",
    },
    ensure_ascii=False,
)


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


def _parse_chat_response(resp: httpx.Response) -> dict:
    """Coerce the endpoint's reply into ``{response, docs, raw}``.

    The agent isn't consistent about its reply shape: sometimes a JSON object
    ``{"response": ..., "docs": [...]}``, sometimes a bare JSON string, and
    sometimes plain text (not JSON at all). ``resp.json()`` only handles the
    first; the bare-text case raises ``Expecting value: line 1 column 1``. So we
    parse defensively: a dict is read as the contract, anything else (str / list
    / number / non-JSON body) is treated as the answer text itself."""
    try:
        data = resp.json()
    except (json.JSONDecodeError, ValueError):
        # Not JSON at all — the whole body is the answer.
        text = resp.text.strip()
        return {"response": text, "docs": [], "raw": text}
    if isinstance(data, dict):
        return {
            "response": str(data.get("response") or ""),
            "docs": _normalize_docs(data.get("docs")),
            "raw": data,
        }
    # Valid JSON but not an object (e.g. a quoted string) — use it as the answer.
    return {"response": str(data), "docs": [], "raw": data}


def _request_headers(*, auth_key: str | None = None, user_id: str | None = None) -> dict[str, str]:
    """Auth + user-id headers. The header NAMES default to "auth-key" / "user-id"
    but are overridable via EXTERNAL_AUTH_HEADER / EXTERNAL_USER_HEADER (gateways
    differ — e.g. "Authorization" / "X-User-Id"). The header VALUES come from
    settings, but a non-None ``auth_key`` / ``user_id`` override them (used by the
    DB-free direct test, which lets the caller aim at an arbitrary endpoint).
    Empty values are dropped so an unconfigured header is simply omitted."""
    s = get_settings()
    auth_name = s.external_auth_header.strip() or "auth-key"
    user_name = s.external_user_header.strip() or "user-id"
    ak = (auth_key if auth_key is not None else s.external_auth_key).strip()
    uid = (user_id if user_id is not None else s.external_user_id).strip()
    headers: dict[str, str] = {}
    if ak:
        headers[auth_name] = ak
    if uid:
        headers[user_name] = uid
    return headers


def _chat_payload(*, message: str, user_id: str | None = None) -> dict:
    """Build the external chat-request body. The agent now expects more than just
    {message, user_id}: session_id / chat_type / a2a_remote_urls / is_super_agent
    / main_model_name / session_system_prompt. The extra fields come from the
    EXTERNAL_* settings (defaults mirror the agent's contract); empty
    main_model_name is sent as null. ``user_id`` overrides the configured one when
    given (direct test)."""
    s = get_settings()
    return {
        "message": message,
        "user_id": user_id if user_id is not None else s.external_user_id,
        "session_id": s.external_session_id,
        # The agent routes on chat_type; an empty value isn't a valid route, so
        # default to "default" when unset.
        "chat_type": "default",
        "a2a_remote_urls": None,
        "is_super_agent": s.external_is_super_agent,
        "main_model_name": s.external_main_model_name or None,
        "session_system_prompt": _SESSION_SYSTEM_PROMPT,
    }


async def run_flow(*, message: str, timeout_s: float = 60.0) -> dict:
    """POST one turn to the external chat endpoint and return ``{response, docs}``.

    The external model resolves its SYSTEM_PROMPT/USER_PROMPT/MODEL_NM from the
    active PM_NODE_PROMPT_VER row by itself — see module docstring.
    """
    payload = _chat_payload(message=message)
    headers = _request_headers()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(_base_url(), json=payload, headers=headers)
            resp.raise_for_status()
            parsed = _parse_chat_response(resp)
    except Exception as exc:  # noqa: BLE001
        raise ExternalAgentError(f"chat run failed: {exc}") from exc
    return {"response": parsed["response"], "docs": parsed["docs"]}


def ensure_direct_url(base_url: str | None = None) -> str:
    """Resolve the direct-call target URL (request override, else settings) and
    raise a clear error when none is configured. Returns the normalized URL."""
    url = (base_url or get_settings().external_agent_base_url).strip().rstrip("/")
    if not url:
        raise ExternalAgentError(
            "호출할 외부 API URL이 없습니다 — 요청에 base_url을 넣거나 EXTERNAL_AGENT_BASE_URL(.env)을 설정하세요"
        )
    return url


async def run_direct(
    *,
    message: str,
    base_url: str | None = None,
    auth_key: str | None = None,
    user_id: str | None = None,
    timeout_s: float = 60.0,
) -> dict:
    """One-shot direct call to the external chat endpoint — NO DB, NO dataset,
    NO scoring. Sends ``message`` straight to the endpoint and returns its answer
    as-is (parsed ``response`` + ``docs`` plus the full ``raw`` body).

    Unlike :func:`run_flow` this does not require RUN_MODE=external and lets the
    caller override the target URL / auth / user-id, so an arbitrary endpoint can
    be smoke-tested without any .env or DB setup. The external model still resolves
    its own prompt on its side — this system just relays the message and answer.
    """
    url = ensure_direct_url(base_url)
    payload = _chat_payload(message=message, user_id=user_id)
    headers = _request_headers(auth_key=auth_key, user_id=user_id)
    # TEMP debug: print the exact JSON body we send so we can confirm
    # session_system_prompt is actually included in the outgoing request.
    # (print, not logger — the app configures no logging handler, so INFO is dropped.)
    print(f"[DIRECT] → {url} body={json.dumps(payload, ensure_ascii=False)}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            # TEMP debug: surface what actually came back so a non-JSON body
            # (SSE stream / HTML error page / empty) is visible instead of being
            # hidden behind a bare "Expecting value: line 1 column 1" decode error.
            ctype = resp.headers.get("content-type", "")
            print(
                f"[DIRECT] ← status={resp.status_code} content-type={ctype!r} "
                f"len={len(resp.content)} body[:500]={resp.text[:500]!r}",
                flush=True,
            )
            return _parse_chat_response(resp)
    except ExternalAgentError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ExternalAgentError(f"direct call failed: {exc}") from exc


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
