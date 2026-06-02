---
name: connect-prompt-mgmt
description: >-
  Wire this prompt-management backend to the internal chat / super-agent model.
  Two paths: (A) refactor the agent so it reads its per-node SYSTEM_PROMPT +
  USER_PROMPT from the shared Oracle DB (the active PM_NODE_PROMPT_VER row) instead
  of hardcoded prompt.py constants, and (B) this system drives the model's chat
  endpoint to run flow tests & RAGAS. Single shared Oracle DB — CHAT_VER_MAS /
  NODE_MAS owned by the agent, PM_NODE_PROMPT_VER owned by PM and read by the agent,
  join key NODE_NM, no sync job. Use when connecting the backend in `backend/` to
  the internal model, on an internal network.
---

# Connect prompt-management ↔ the internal chat model

You are wiring **this** repo's prompt-management backend (`backend/`, FastAPI +
Oracle, prefix `/api/v1`) to the **internal model** — a chat / super-agent service.
Work on an internal network. Go **one stage at a time** and run the verification
at the end of each stage before moving on.

> The agent and this backend share **one Oracle DB**. The real integration work in
> Path A is **changing the agent's code** so it reads managed prompts from the DB —
> today the agent **hardcodes** them. Do NOT assume the agent already reads the DB.

## Ground truth (this repo) — read before wiring

- **One flow, one shared Oracle DB.** No projects. The agent owns two FIXED tables
  (structure never changed by PM): `CHAT_VER_MAS` (`GRAPH_STRUCT` mermaid +
  `MAIN_MODEL_NM`) and `NODE_MAS` (nodes; `PROMPT_EDIT_ENABLE_YN='Y'` = a prompt
  node). **Join key = `NODE_NM`** (unique within the current flow).
- **PM owns `PM_NODE_PROMPT_VER`** — versioned prompts split into `SYSTEM_PROMPT` +
  `USER_PROMPT`, with `IS_ACTIVE` (one active row per node). This is a **shared-read
  contract table**: the agent reads the active row to get BOTH prompts for a node.
- **The agent currently HARDCODES prompts** in its own project under
  `prompt/<node>/prompt.py` as `<node>_SYSTEM_PROMPT = "..."` /
  `<node>_USER_PROMPT = "..."`, filling variables at runtime. **Path A replaces those
  constants with a DB loader** that reads the active `PM_NODE_PROMPT_VER` row for the
  node by `NODE_NM` (`IS_ACTIVE='Y'`) and returns both prompts; the agent fills its
  variables exactly as before.
- **`NODE_MAS.PROMPT` is not read by anyone.** The agent reads `PM_NODE_PROMPT_VER`,
  not `NODE_MAS.PROMPT`. The activation step in this backend that mirrors
  `SYSTEM_PROMPT` into `NODE_MAS.PROMPT` is **vestigial** — activation only needs to
  flip `IS_ACTIVE` and cut a `PM_FLOW_VER` snapshot.
- **Runtime read API (inspection only):** `GET /api/v1/active-prompts`
  (all active prompts keyed by `node_nm`) and
  `GET /api/v1/nodes/by-name/{node_nm}/active-prompt`. Each payload has
  `system_prompt` + `user_prompt` — the **same data** the agent's loader reads. Use
  it to verify the loader, not as the agent's runtime path.
- **External-call adapter:** `backend/app/services/external_agent.py:run_flow`
  POSTs one turn to the model's chat endpoint, gated by `RUN_MODE=external` +
  `EXTERNAL_AGENT_BASE_URL`. The request body is just `{message, user_id}` —
  the model loads its prompts via the DB loader (Path A), not from the request.
- **A/B comparison** runs by temporarily flipping `IS_ACTIVE` so the version
  under test becomes the active row for the duration of the run, then
  restoring the original active row in a `finally`. The agent's DB loader must
  read the active row at evaluation time (not from a long-lived cache).

## Path A — the agent's DB loader (the core change)

Replace the hardcoded `<node>_SYSTEM_PROMPT` / `<node>_USER_PROMPT` constants with a
loader that reads the active row (Oracle):

```sql
SELECT v.SYSTEM_PROMPT, v.USER_PROMPT
FROM   PM_NODE_PROMPT_VER v
JOIN   NODE_MAS n ON n.ID = v.NODE_MAS_ID
WHERE  n.NODE_NM = :node_nm AND v.IS_ACTIVE = 'Y'
```

The agent's node identifiers must equal `NODE_MAS.NODE_NM`. Full `python-oracledb`
loader snippet + caching note in `references/03-mapping.md`.

## The chat contract (Path B — the model's run endpoint)

`POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}`

```json
request:  { "message": "<test input>", "user_id": "pm-test" }
response: { "response": "<answer>",
            "service_id": "...", "session_id": "...", "user_id": "...", "trace_id": "...",
            "docs": [...], "urls": [], "images": [], "db_data": [],
            "followup_questions": [], "knowhows": [] }
```

The backend uses only `response` (the answer) and `docs` (used as RAGAS retrieved
contexts when the dataset case doesn't pin its own). All other fields are
accepted and ignored. The model resolves SYSTEM_PROMPT/USER_PROMPT itself from
the active `PM_NODE_PROMPT_VER` row — not from the request. See
`references/02-api-contract.md`.

## Stages

### Stage 0 — Discovery (do this FIRST)
Read `references/04-discovery.md` and record in `references/03-mapping.md`:
(1) the agent's **prompt module layout** (`prompt/<node>/prompt.py` constants) and
how it fills variables, so the loader can replace them; (2) confirm the agent's node
identifiers **equal `NODE_MAS.NODE_NM`** and that the agent can reach the shared
Oracle DB; (3) the model's chat endpoint **path**. **Do not wire until these are recorded.**

### Stage A — Refactor the agent to read prompts from the DB
1. Add the DB loader (query above) to the agent; point it at the shared Oracle DSN.
2. Replace each `<node>_SYSTEM_PROMPT` / `<node>_USER_PROMPT` constant with a call
   that loads the active row for that `NODE_NM`. Keep the agent's variable-filling.
3. Verify against this backend:
   `python scripts/fetch_active_prompts.py --base-url http://localhost:8000`
   prints active prompts keyed by `node_nm` with `system_prompt`/`user_prompt` — the
   agent's loader must return the same text for each node.

### Stage B — Flow test drive (this system calls the model)
1. Confirm the chat contract with `python scripts/callback_probe.py --base-url <model-url>`
   (posts `{message, user_id}` and verifies a non-empty `response` field).
2. Wire: set `RUN_MODE=external`, `EXTERNAL_AGENT_BASE_URL`, `EXTERNAL_CHAT_PATH`,
   `EXTERNAL_USER_ID` in `backend/.env` per `references/02-api-contract.md` §Wiring;
   restart; run a flow RAGAS / A·B RAGAS.

## References (load as needed)
- `references/01-architecture.md` — the 2 paths + shared-DB diagram.
- `references/02-api-contract.md` — read JSON + chat payload + wiring env.
- `references/03-mapping.md` — table ↔ field map, the agent DB loader, activation rule.
- `references/04-discovery.md` — the Stage-0 checklist.

## Verify before finishing
- `cd backend; $env:APP_ENV='test'; .venv\Scripts\python.exe -m pytest` stays green.
- `fetch_active_prompts.py` returns real data (system/user) for each active node.
- The agent's DB loader returns the same `system_prompt`/`user_prompt` as the API,
  and the agent runs with the managed prompt (not its old hardcoded constant).
- A flow run with `RUN_MODE=external` produces an answer sourced from the model.
