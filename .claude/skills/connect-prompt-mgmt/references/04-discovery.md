# 04 — Stage 0 discovery checklist

Answer these before wiring. Record results in `03-mapping.md`. Prefer reading
code / API docs over guessing.

## 1. The agent's prompt layout (Path A target)
- Locate the hardcoded prompts: `prompt/<node>/prompt.py` with
  `<node>_SYSTEM_PROMPT` / `<node>_USER_PROMPT` constants. List every node file and
  its constant names.
- Note **how the agent fills variables** into those prompts (placeholder syntax,
  where substitution happens) so the DB loader drops in without changing that step.
- Confirm the agent's node identifiers **equal `NODE_MAS.NODE_NM`** (the loader keys
  on `NODE_NM`). Record any mismatch + the mapping rule.
- Confirm the agent process can reach the shared Oracle DB (DSN / credentials).

## 2. Chat endpoint (Path B)
- The **path** appended to `EXTERNAL_AGENT_BASE_URL` (e.g. `/chat`, `/v1/chat`,
  `/run`). → `EXTERNAL_CHAT_PATH`.
- Confirm it accepts the payload in `02-api-contract.md` §Callback
  (`message`, `user_id`, `session_id`, `chat_type`, `a2a_remote_urls`,
  `is_super_agent`, `main_model_name`, `session_system_prompt`). Note any field the
  model requires differently (→ set the `EXTERNAL_*` env defaults, or adjust the
  payload builder in `external_agent.run_flow`).

## 3. Response shape (the answer field)
- Send one probe and record **which field holds the assistant answer**
  (`output` / `answer` / `response` / `message` / `content` / `result` / `text`, or
  nested). `run_flow._extract_answer` auto-detects those; if the model differs, pin
  it in `external_agent._ANSWER_KEYS`. Note any token/latency fields if present.

## 4. RAG retrieval entrypoint (optional, for RAGAS grounding)
- If the model exposes a retriever, note its `POST /retrieve` contract
  (`{query, top_k}` → `{contexts: [str]}`) for `external_agent.retrieve`. If not,
  RAGAS uses the dataset's own `contexts`; skip `/retrieve`.

## Reachability / auth (internal network)
- Both legs must be reachable: **agent → shared Oracle DB** (Path A) and **this
  backend → model chat endpoint** (Path B). Note any required headers/tokens
  (neither system has built-in HTTP auth — network-level only).
- Record the base URL → `EXTERNAL_AGENT_BASE_URL` and the Oracle DSN.
