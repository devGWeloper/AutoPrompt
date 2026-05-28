# 03 — Field mapping, the agent DB loader & activation rule

> The agent and PM share **one Oracle DB**. PM versions prompts in
> `PM_NODE_PROMPT_VER` and flips `IS_ACTIVE`; the agent reads the active row. No
> cross-system sync job. Join key everywhere: **`NODE_NM`** (unique within the
> current flow).

## Agent-owned tables (structure FIXED — never altered by PM)

| Agent table / column            | Used by PM as                                  |
|---------------------------------|------------------------------------------------|
| `CHAT_VER_MAS.ID`               | current flow id (`get_current_chat`)           |
| `CHAT_VER_MAS.GRAPH_STRUCT`     | flow graph definition (no longer rendered — graph screen removed) |
| `CHAT_VER_MAS.MAIN_MODEL_NM`    | flow main model (passed to the agent on RAGAS runs) |
| `NODE_MAS.ID`                   | node id; FK target of `PM_NODE_PROMPT_VER.NODE_MAS_ID` |
| `NODE_MAS.CHAT_VER_ID`          | FK → `CHAT_VER_MAS.ID`                          |
| `NODE_MAS.NODE_NM`              | node identity / join key (= the agent's node name) |
| `NODE_MAS.NODE_DESC`            | node description                               |
| `NODE_MAS.MODEL_NM`             | node model name (provider inferred from it)    |
| `NODE_MAS.PROMPT_EDIT_ENABLE_YN`| `'Y'` ⇒ LLM/prompt node (the only manageable)  |
| `NODE_MAS.PROMPT`               | **not used** by anyone — see activation rule below |

PM never changes the **structure** of these two tables; it only reads them.

## PM-owned table the agent READS: `PM_NODE_PROMPT_VER`

Versioned node prompts, `NODE_MAS_ID` anchor, split into **`SYSTEM_PROMPT` +
`USER_PROMPT`**, with `IS_ACTIVE` (`'Y'`/`'N'`, one active per node). The agent reads
the active row for each node to get both prompts. Other PM-owned tables
(`PM_FLOW_VER` + `PM_FLOW_VER_NODE`, `PM_TEST_*`, `PM_RAGAS_*`, `PM_AUDIT_LOG`) are
PM-internal — the agent does not read them.

### The agent's DB loader (replaces the hardcoded prompt.py constants)

```sql
SELECT v.SYSTEM_PROMPT, v.USER_PROMPT
FROM   PM_NODE_PROMPT_VER v
JOIN   NODE_MAS n ON n.ID = v.NODE_MAS_ID
WHERE  n.NODE_NM = :node_nm AND v.IS_ACTIVE = 'Y'
```

```python
import oracledb  # python-oracledb

def load_node_prompts(node_nm: str) -> tuple[str, str]:
    """(system_prompt, user_prompt) for the active version of node_nm."""
    conn = oracledb.connect(user=ORACLE_USER, password=ORACLE_PASSWORD, dsn=ORACLE_DSN)
    with conn, conn.cursor() as cur:
        cur.execute(
            "SELECT v.SYSTEM_PROMPT, v.USER_PROMPT "
            "FROM PM_NODE_PROMPT_VER v JOIN NODE_MAS n ON n.ID = v.NODE_MAS_ID "
            "WHERE n.NODE_NM = :node_nm AND v.IS_ACTIVE = 'Y'",
            node_nm=node_nm,
        )
        row = cur.fetchone()
    if not row:
        raise LookupError(f"no active prompt for node {node_nm!r}")
    return (row[0] or ""), (row[1] or "")
```

In the agent, replace e.g.

```python
GENERATE_SYSTEM_PROMPT = "..."   # old: hardcoded in prompt/generate/prompt.py
GENERATE_USER_PROMPT   = "..."
```
with
```python
GENERATE_SYSTEM_PROMPT, GENERATE_USER_PROMPT = load_node_prompts("generate")
```
The agent fills its variables into these exactly as before. **Caching:** loading at
import freezes prompts at process start — cache per process and refresh on restart
(or a signal) after an activation, since `IS_ACTIVE` changes between runs.

## Activation rule (no sync script, no NODE_MAS.PROMPT write needed)

Editing happens only in the PM UI. **Activate** does, in one transaction:
1. flip `IS_ACTIVE` on `PM_NODE_PROMPT_VER` (one active per node),
2. cut a new `PM_FLOW_VER` snapshot (whole-flow version bumps; node versions kept).

The agent picks up the new prompt by reading the active `PM_NODE_PROMPT_VER` row.
> This backend currently *also* writes `SYSTEM_PROMPT` into `NODE_MAS.PROMPT` on
> activation (`prompt_service.activate_version`, ~line 296). Since nobody reads
> `NODE_MAS.PROMPT`, that mirror is **vestigial** — it can be removed and does no
> harm if left.

## node_nm reconciliation
The agent's node identifiers must equal `NODE_MAS.NODE_NM` (= the loader's `:node_nm`
and the mermaid node ids on the home screen). Keep them equal; if the operational
graph's mermaid ids differ, adjust the clickable-node mapping in
`frontend/src/components/graph/MermaidGraph.tsx` + the home page.
