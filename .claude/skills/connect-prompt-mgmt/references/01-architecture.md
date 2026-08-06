# 01 — Architecture: the two integration paths

One **shared Oracle DB** plus one **HTTP chat contract**. The agent owns the fixed
structure tables (`CHAT_VER_MAS`, `NODE_MAS`); PTX owns the versioned prompt table
(`PTX_PROMPT_HIS`), which the agent **reads** for its prompts. The join key
everywhere is **`NODE_NM`**.

```
        ┌──────────────────────────────┐        ┌───────────────────────────────┐
        │  Prompt-Mgmt backend (this)  │        │  Internal chat / super-agent   │
        │  FastAPI /api/v1             │        │  one chat endpoint             │
        │  owns PTX_PROMPT_HIS      │        │  prompt/<node>/prompt.py        │
        │  (SYSTEM_PROMPT/USER_PROMPT)  │        │  (today: hardcoded constants)  │
        └──────────────┬───────────────┘        └────────────────┬──────────────┘
                       │                                          │
       shared Oracle DB (CHAT_VER_MAS / NODE_MAS / PTX_PROMPT_HIS)
                       │                                          │
   (A) READ  PTX writes versions + flips IS_ACTIVE on              │
             PTX_PROMPT_HIS                                    │
                       │  agent's DB loader reads the active row ─►│  (replaces the
                       │  SELECT SYSTEM_PROMPT, USER_PROMPT        │   hardcoded
                       │  WHERE NODE_NM=? AND IS_ACTIVE='Y'        │   constants)
                       │  (GET /active-prompts = inspection only)  │
                       │                                          │
   (B) DRIVE  this system runs flow-level RAGAS                   │
   flow test ───► POST {model}{EXTERNAL_CHAT_PATH} ───────────────► one chat turn
                  {message, user_id}  →  {response, docs, ...}
                  (the agent reads its prompts from the active
                   PTX_PROMPT_HIS row in the shared DB)
```

For A/B comparison, PTX flips `PTX_PROMPT_HIS.IS_ACTIVE` to the version under
test for the duration of the run, then restores the original — the agent's DB
loader must read fresh per evaluation (no long-lived cache during runs).

## Why these choices
- **Shared DB for prompts, HTTP for execution.** PTX versions prompts in
  `PTX_PROMPT_HIS` and flips `IS_ACTIVE`; the agent reads the active row from the
  same DB. There is **no sync job** and **no push** — but the agent must be changed
  to read the DB (Path A); today it hardcodes its prompts.
- **Both system and user prompts are managed.** `PTX_PROMPT_HIS` splits
  `SYSTEM_PROMPT` + `USER_PROMPT`; the agent loads BOTH for each node and fills its
  variables as before. (`NODE_MAS.PROMPT` is not used — see `03-mapping.md`.)
- **Single ownership, no merge conflicts.** Graph shape / node existence are the
  agent's (PTX reads `CHAT_VER_MAS` / `NODE_MAS`); prompt text / version / active flag
  are PTX's (`PTX_PROMPT_HIS`, which the agent reads). Every field has one writer.

## Resilience
The agent reads prompts straight from `PTX_PROMPT_HIS` (shared DB), so it keeps
working if this backend's HTTP API is down — only the DB must be up. The
`GET /active-prompts` read is only for inspection / verifying the loader.

**Caching policy:** the agent may cache the loaded prompts, but the cache must be
invalidated on activation (PTX-driven). Since A/B RAGAS toggles `IS_ACTIVE` for
the duration of a run, either keep the cache TTL short or re-read per request
during evaluation. PTX restores the original active row in a `finally`, so steady
state after the run matches what was active before.
