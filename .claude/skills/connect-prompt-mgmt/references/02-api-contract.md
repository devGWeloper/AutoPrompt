# 02 — API contract & backend wiring

> Single-flow **CHAT_VER_MAS / NODE_MAS** (agent-owned) + **PM_NODE_PROMPT_VER**
> (PM-owned, **agent-read**). Join key **`NODE_NM`**. The agent reads its per-node
> `SYSTEM_PROMPT` + `USER_PROMPT` from the active `PM_NODE_PROMPT_VER` row (loader in
> `03-mapping.md`); the HTTP "active-prompts" read below mirrors that data for
> inspection / verification only.

## §Read — prompts this backend serves (inspection / verification)

`GET /api/v1/active-prompts` → object keyed by `node_nm`:

```json
{
  "generate": {
    "node_mas_id": 3,
    "node_nm": "generate",
    "prompt_id": 1,
    "version_no": "1.0.0",
    "system_prompt": "당신은 ...",
    "user_prompt": "Context:\n{{context}}\n\nQuestion: {{question}}",
    "model_nm": "gemini-2.5-flash"
  }
}
```
Nodes without an active version are omitted. Single node:
`GET /api/v1/nodes/by-name/{node_nm}/active-prompt` → one such object, or `404`.
`user_prompt` is a free-text template whose `{{var}}` the agent fills at runtime
(and the flow test fills from the dataset case JSON).

**Primary runtime path:** the agent reads the active `PM_NODE_PROMPT_VER` row
(`SYSTEM_PROMPT` + `USER_PROMPT`) directly from the shared Oracle DB. This API
returns the same data — use it to verify the agent's loader, not as its runtime path.

## §Callback — the internal model's chat endpoint (this backend calls it)

The flow-level RAGAS run drives the model through ONE chat endpoint. Must match
`backend/app/services/external_agent.py:run_flow`.

`POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}`  (default path `/chat`)

request:
```json
{ "message": "<test input>", "user_id": "pm-test" }
```
response:
```json
{ "response": "<answer>",
  "service_id": "...", "session_id": "...", "user_id": "...", "trace_id": "...",
  "docs": ["...", "..."],
  "urls": [], "images": [], "db_data": [],
  "followup_questions": [], "knowhows": [] }
```
The backend reads only `response` (assistant answer) and `docs` (used as RAGAS
retrieved contexts when the dataset case doesn't pin its own). All other fields
are accepted and ignored.

The external model resolves its per-node `SYSTEM_PROMPT` + `USER_PROMPT` itself
by reading the active `PM_NODE_PROMPT_VER` row directly from the shared Oracle DB
(see `03-mapping.md`). The chat request does NOT carry a system prompt.

**A/B comparison:** when an A/B RAGAS run is executing, PM temporarily flips
`PM_NODE_PROMPT_VER.IS_ACTIVE` so the version under test becomes the active row
for the duration of that run, then restores the original active row in a
`finally` — see `flow_service._swap_active_prompt` / `_restore_active_prompt`.

Field mapping (set by `flow_service`):
- `message` ← the dataset case input (its `message` / `question` / … value).
- `user_id` ← static `EXTERNAL_USER_ID` from env.

Backend endpoints that call it: `POST /flow/test/ragas`, `/flow/test/ragas/ab`.

## §Wiring — enable the external flow test

In `backend/.env`:
```
RUN_MODE=external
EXTERNAL_AGENT_BASE_URL=http://<model-host>:<port>
EXTERNAL_CHAT_PATH=/chat                 # the model's real chat path
EXTERNAL_USER_ID=pm-test
```
`flow_service.execute_flow_ragas_run()` branches on
`external_agent.external_enabled()` and posts the chat payload, storing the
answer as `PM_RAGAS_RESULT` rows and streaming over `/ws/ragas-runs/{id}`.

After editing env: `cd backend; $env:APP_ENV='test'; .venv\Scripts\python.exe -m pytest`
must stay green (stub mode), then restart uvicorn with the new env.
