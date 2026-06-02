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
- Decide the **cache policy** for the loader — must be invalidated on activation
  and on `IS_ACTIVE` toggle during an A/B RAGAS run. Re-read per request is the
  simplest safe choice; see `03-mapping.md` "Caching policy".

## 2. Chat endpoint (Path B)
- The **path** appended to `EXTERNAL_AGENT_BASE_URL` (e.g. `/chat`, `/v1/chat`,
  `/run`). → `EXTERNAL_CHAT_PATH`.
- Confirm it accepts the contract in `02-api-contract.md` §Callback —
  request body `{message, user_id}`, response carries `response` (the assistant
  answer) and `docs` (used as RAGAS retrieved contexts when the dataset case
  doesn't pin its own). The other response fields (service_id, session_id,
  user_id, trace_id, urls, images, db_data, followup_questions, knowhows) are
  accepted and ignored — no need to change them.
- Run `scripts/callback_probe.py --base-url <model-url> --path <path>` to
  verify the model returns a non-empty `response`.

## Reachability / auth (internal network)
- Both legs must be reachable: **agent → shared Oracle DB** (Path A) and **this
  backend → model chat endpoint** (Path B). Note any required headers/tokens
  (neither system has built-in HTTP auth — network-level only).
- Record the base URL → `EXTERNAL_AGENT_BASE_URL` and the Oracle DSN.
