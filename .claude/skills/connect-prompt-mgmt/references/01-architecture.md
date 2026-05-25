# 01 — Architecture: the two integration paths

One **shared Oracle DB** plus one **HTTP chat contract**. The agent owns the fixed
structure tables (`CHAT_VER_MAS`, `NODE_MAS`); PM owns the versioned prompt table
(`PM_NODE_PROMPT_VER`), which the agent **reads** for its prompts. The join key
everywhere is **`NODE_NM`**.

```
        ┌──────────────────────────────┐        ┌───────────────────────────────┐
        │  Prompt-Mgmt backend (this)  │        │  Internal chat / super-agent   │
        │  FastAPI /api/v1             │        │  one chat endpoint             │
        │  owns PM_NODE_PROMPT_VER      │        │  prompt/<node>/prompt.py        │
        │  (SYSTEM_PROMPT/USER_PROMPT)  │        │  (today: hardcoded constants)  │
        └──────────────┬───────────────┘        └────────────────┬──────────────┘
                       │                                          │
       shared Oracle DB (CHAT_VER_MAS / NODE_MAS / PM_NODE_PROMPT_VER)
                       │                                          │
   (A) READ  PM writes versions + flips IS_ACTIVE on              │
             PM_NODE_PROMPT_VER                                    │
                       │  agent's DB loader reads the active row ─►│  (replaces the
                       │  SELECT SYSTEM_PROMPT, USER_PROMPT        │   hardcoded
                       │  WHERE NODE_NM=? AND IS_ACTIVE='Y'        │   constants)
                       │  (GET /active-prompts = inspection only)  │
                       │                                          │
   (B) DRIVE  this system runs flow tests / RAGAS                 │
   flow test ───► POST {model}{EXTERNAL_CHAT_PATH} ───────────────► one chat turn
                  message=<input>, session_system_prompt=<prompt under test>,
                  main_model_name=<flow main model>  → {answer}
```

## Why these choices
- **Shared DB for prompts, HTTP for execution.** PM versions prompts in
  `PM_NODE_PROMPT_VER` and flips `IS_ACTIVE`; the agent reads the active row from the
  same DB. There is **no sync job** and **no push** — but the agent must be changed
  to read the DB (Path A); today it hardcodes its prompts.
- **Both system and user prompts are managed.** `PM_NODE_PROMPT_VER` splits
  `SYSTEM_PROMPT` + `USER_PROMPT`; the agent loads BOTH for each node and fills its
  variables as before. (`NODE_MAS.PROMPT` is not used — see `03-mapping.md`.)
- **Single ownership, no merge conflicts.** Graph shape / node existence are the
  agent's (PM reads `CHAT_VER_MAS` / `NODE_MAS`); prompt text / version / active flag
  are PM's (`PM_NODE_PROMPT_VER`, which the agent reads). Every field has one writer.

## Resilience
The agent reads prompts straight from `PM_NODE_PROMPT_VER` (shared DB), so it keeps
working if this backend's HTTP API is down — only the DB must be up. The
`GET /active-prompts` read is only for inspection / verifying the loader. Cache the
loaded prompts in the agent and refresh on a signal or restart after an activation
(`IS_ACTIVE` changes between runs).
