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

The **flow test** (single / batch / A·B / RAGAS) drives the model through ONE chat
endpoint. Must match `backend/app/services/external_agent.py:run_flow`.

`POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}`  (default path `/chat`)

request:
```json
{ "message": "<test input>", "user_id": "pm-test", "session_id": "<uuid>",
  "chat_type": "default", "a2a_remote_urls": null, "is_super_agent": null,
  "main_model_name": "<flow main model>", "session_system_prompt": "<prompt under test>" }
```
response (the assistant answer):
```json
{ "output": "<answer>" }
```
> **>>> FILL IN (Stage 0):** the real answer field. `run_flow` auto-detects
> `output` / `answer` / `response` / `message` / `content` / `result` / `text`
> (and one nested level); if the model uses another field, pin it in
> `external_agent._ANSWER_KEYS`.

Field mapping (set by `flow_service`):
- `message` ← the dataset case input (its `message`/`question`/… value) or the flow input.
- `session_system_prompt` ← the **prompt version under test** (so a flow test can
  exercise a draft without activating it). `flow_service._flow_session_system_prompt`
  joins the active prompt nodes' `SYSTEM_PROMPT`s. >>> FILL IN if the model should
  instead read the version under test from the DB, or wants a single node's prompt.
- `main_model_name` ← `CHAT_VER_MAS.MAIN_MODEL_NM` (for A/B, the version's main model).
- `user_id` / `chat_type` / `is_super_agent` / `a2a_remote_urls` ← static defaults
  from env (below).

Backend endpoints that call it: `POST /flow/test/run`, `/flow/test/batch`,
`/flow/test/ab`, `/flow/test/ragas`.

Optional, for RAGAS context grounding (`external_agent.retrieve`):
`POST {EXTERNAL_AGENT_BASE_URL}/retrieve` → request `{"query": "<text>", "top_k": 5}`,
response `{"contexts": ["...", "..."]}`. Skip if the model has no RAG endpoint.

## §Wiring — enable the external flow test

In `backend/.env`:
```
RUN_MODE=external
EXTERNAL_AGENT_BASE_URL=http://<model-host>:<port>
EXTERNAL_CHAT_PATH=/chat                 # the model's real chat path
# static payload fields (override only if the model needs different values)
EXTERNAL_CHAT_TYPE=default
EXTERNAL_USER_ID=pm-test
# EXTERNAL_IS_SUPER_AGENT=true
# EXTERNAL_A2A_REMOTE_URLS=http://a,http://b   # comma-separated -> list; unset -> null
```
`flow_service.execute_flow_test_run()` / `execute_flow_dataset_run()` /
`execute_flow_ragas_run()` already branch on `external_agent.external_enabled()`
and post the chat payload, storing the answer as `PM_TEST_RESULT` rows and
streaming over `/ws/flow-runs/{run_id}` (or `/ws/ragas-runs/{id}`).

> **Node-level** tests run with this system's own LLM adapters — on the internal
> network these route to the OpenAI-compatible gateway in `LLM_ENDPOINT` /
> `LLM_API_KEY` / `LLM_MODEL_NAME` (provider inference is then bypassed). They do
> NOT call the chat model — only the **flow** tests do.

After editing env: `cd backend; $env:APP_ENV='test'; .venv\Scripts\python.exe -m pytest`
must stay green (internal mode), then restart uvicorn with the new env.
