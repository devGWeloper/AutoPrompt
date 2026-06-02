#!/usr/bin/env python3
"""Probe the internal model's chat endpoint for contract match.

Run this against the model BEFORE wiring this backend to it. It sends the exact
payload `backend/app/services/external_agent.py:run_flow` will send and checks
that the response carries a non-empty ``response`` string. Stdlib only.

    python callback_probe.py --base-url http://model-host:9000 --path /chat
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def _post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - trusted internal host
        return json.loads(resp.read().decode("utf-8"))


def check_chat(base_url: str, path: str, user_id: str) -> list[str]:
    if not path.startswith("/"):
        path = "/" + path
    payload = {"message": "Echo OK.", "user_id": user_id}
    body = _post(f"{base_url.rstrip('/')}{path}", payload)
    problems: list[str] = []
    if not isinstance(body, dict):
        return [f"chat response is not a JSON object (got {type(body).__name__})"]
    resp = body.get("response")
    if not isinstance(resp, str) or not resp:
        keys = list(body.keys())
        problems.append(
            f"chat response 'response' field missing or empty (got keys: {keys})"
        )
    docs = body.get("docs")
    if docs is not None and not isinstance(docs, list):
        problems.append(f"chat response 'docs' must be a list (got {type(docs).__name__})")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True, help="model base url, e.g. http://model:9000")
    ap.add_argument("--path", default="/chat", help="chat endpoint path (EXTERNAL_CHAT_PATH)")
    ap.add_argument("--user-id", default="pm-test", help="user_id field value (EXTERNAL_USER_ID)")
    args = ap.parse_args()

    try:
        problems = check_chat(args.base_url, args.path, args.user_id)
    except urllib.error.HTTPError as e:
        problems = [f"{args.path} HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"]
    except urllib.error.URLError as e:
        problems = [f"{args.path} connection failed: {e}"]

    if problems:
        print("FAIL:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"OK  {args.path}")
    print("\nChat contract OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
