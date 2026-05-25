#!/usr/bin/env python3
"""Fetch the current flow's active prompts from the prompt-management backend.

Verification tool: the data returned here (system_prompt + user_prompt per node)
must match what the agent's DB loader reads from the active PM_NODE_PROMPT_VER row
(see references/03-mapping.md). At runtime the agent reads that table directly from
the shared Oracle DB; this HTTP read is for inspection only. Keyed by NODE_NM.
Stdlib only.

    python fetch_active_prompts.py --base-url http://localhost:8000
    python fetch_active_prompts.py --base-url http://localhost:8000 --node-nm generate
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def get_active_prompts(base_url: str) -> dict:
    """Return {node_nm: active_prompt_payload} for the current flow."""
    url = f"{base_url.rstrip('/')}/api/v1/active-prompts"
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310 - trusted internal host
        return json.loads(resp.read().decode("utf-8"))


def get_active_prompt(base_url: str, node_nm: str) -> dict:
    url = f"{base_url.rstrip('/')}/api/v1/nodes/by-name/{node_nm}/active-prompt"
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True, help="e.g. http://localhost:8000")
    ap.add_argument("--node-nm", default=None, help="omit to fetch all active prompts")
    args = ap.parse_args()

    try:
        data = (
            get_active_prompt(args.base_url, args.node_nm)
            if args.node_nm
            else get_active_prompts(args.base_url)
        )
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"connection failed: {e}", file=sys.stderr)
        return 1

    print(json.dumps(data, ensure_ascii=False, indent=2))
    if not args.node_nm:
        print(f"\n{len(data)} active prompt(s): {', '.join(sorted(data))}", file=sys.stderr)
        # quick reminder of the split fields each payload carries
        for nm, p in data.items():
            has_sys = bool(p.get("system_prompt"))
            has_usr = bool(p.get("user_prompt"))
            print(f"  {nm}: system_prompt={'Y' if has_sys else '-'} user_prompt={'Y' if has_usr else '-'}",
                  file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
