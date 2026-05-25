#!/usr/bin/env python3
"""Probe the internal model's chat endpoint for contract match.

Run this against the model BEFORE wiring this backend to it. It sends the exact
payload `backend/app/services/external_agent.py:run_flow` will send and checks the
response holds a usable answer field. Stdlib only.

    python callback_probe.py --base-url http://model-host:9000 --path /chat
    python callback_probe.py --base-url http://model-host:9000 --path /chat --model gpt-4o
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from uuid import uuid4

# Mirror external_agent._ANSWER_KEYS — the fields run_flow will look for.
ANSWER_KEYS = ("output", "answer", "response", "message", "content", "result", "text")


def _post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - trusted internal host
        return json.loads(resp.read().decode("utf-8"))


def _has_answer(body: object) -> bool:
    if isinstance(body, str):
        return bool(body)
    if isinstance(body, dict):
        if any(isinstance(body.get(k), str) and body.get(k) for k in ANSWER_KEYS):
            return True
        return any(isinstance(body.get(k), dict) and _has_answer(body.get(k))
                   for k in ("data", "message", "result"))
    return False


def check_chat(base_url: str, path: str, model: str | None) -> list[str]:
    if not path.startswith("/"):
        path = "/" + path
    payload = {
        "message": "Echo OK.",
        "user_id": "pm-test",
        "session_id": uuid4().hex,
        "chat_type": "default",
        "a2a_remote_urls": None,
        "is_super_agent": None,
        "main_model_name": model,
        "session_system_prompt": "You are a test probe. Reply briefly.",
    }
    body = _post(f"{base_url.rstrip('/')}{path}", payload)
    if not _has_answer(body):
        keys = list(body.keys()) if isinstance(body, dict) else type(body).__name__
        return [
            "chat response has no recognized answer field "
            f"(looked for {ANSWER_KEYS}; got keys: {keys}). "
            ">>> pin the real field in external_agent._ANSWER_KEYS"
        ]
    return []


def check_retrieve(base_url: str) -> list[str]:
    body = _post(f"{base_url.rstrip('/')}/retrieve", {"query": "probe query", "top_k": 3})
    if not isinstance(body, dict) or "contexts" not in body:
        return ["/retrieve response missing 'contexts'"]
    if not isinstance(body["contexts"], list) or not all(isinstance(c, str) for c in body["contexts"]):
        return ["/retrieve 'contexts' must be a list of strings"]
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True, help="model base url, e.g. http://model:9000")
    ap.add_argument("--path", default="/chat", help="chat endpoint path (EXTERNAL_CHAT_PATH)")
    ap.add_argument("--model", default=None, help="main_model_name to send (optional)")
    ap.add_argument("--check-retrieve", action="store_true", help="also probe /retrieve (RAG agent)")
    args = ap.parse_args()

    checks = [(args.path, lambda: check_chat(args.base_url, args.path, args.model))]
    if args.check_retrieve:
        checks.append(("/retrieve", lambda: check_retrieve(args.base_url)))

    all_problems: list[str] = []
    for name, fn in checks:
        try:
            probs = fn()
        except urllib.error.HTTPError as e:
            probs = [f"{name} HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"]
        except urllib.error.URLError as e:
            probs = [f"{name} connection failed: {e}"]
        if probs:
            all_problems.extend(probs)
        else:
            print(f"OK  {name}")

    if all_problems:
        print("\nFAIL:", file=sys.stderr)
        for p in all_problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print("\nChat contract OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
