import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { MODEL_COLS, insertReturningId, mapModelRole } from "@/lib/db/rows";
import { logger } from "@/lib/logger";
import type { ModelRole, ModelRoleCreate, ModelSelection } from "@/lib/types";
import { writeAudit } from "./audit";
import { listLlmModels, llmModelsOn } from "./llms";
import { serverMap } from "./llmServers";
import type { ServerMap } from "./llmServers";
import type { LlmModel } from "@/lib/types";

// PTX_MODEL_MAS holds one row per LLM role the external agent defines in its
// config, plus the model each role should run by default. It is a settings
// table, not the thing the agent reads: a run pins the models that were on
// screen when it started (PTX_CALL_MAS), and these values only decide what the
// run tab starts out holding. The DDL seeds the roles that exist today; adding
// one here is for when the agent's LLMModel enum grows. ROLE_CD is the whole
// contract — a name that does not match an enum member sits in the DB looking
// configured while the agent never reads it, so it is validated on the way in
// and a save against an unknown role is an error rather than a silent insert.

async function fetchAll(conn: OracleConnection): Promise<ModelRole[]> {
  const res = await conn.execute(`SELECT ${MODEL_COLS} FROM PTX_MODEL_MAS ORDER BY MODEL_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapModelRole);
}

export async function listModelRoles(): Promise<ModelRole[]> {
  return readConn(fetchAll, []);
}

/**
 * One role's entry in the staged JSON.
 *
 * `server` / `base_url` / `api_key_ref` are what make a model on a different
 * host reachable at all: the agent's config has one base_url for every role, so
 * without an address a pinned model name is just asked of whatever server that
 * config points at. The address is resolved here, at the moment the run
 * starts, rather than carried in the request from the browser — a server whose
 * URL was edited in settings takes effect on the next run with no stale copy
 * anywhere. `api_key_ref` is the key's *name*; the agent resolves the value on
 * its own host (docs/model-roles-agent.md).
 */
interface PinEntry {
  model?: string;
  temperature?: number;
  server?: string;
  base_url?: string;
  api_key_ref?: string;
}

/** Drop the empty halves and refuse a temperature that would change every answer
 * by accident. Returns undefined when nothing about the role was actually
 * pinned, which is different from `{}` — see :func:`explicitSnapshot`. */
function pin(
  model: string | null,
  temp: number | null,
  server: string | null,
  ctx: PinContext,
): PinEntry | undefined {
  const e: PinEntry = {};
  if (model !== null && model !== "") e.model = model;
  // Temperature alone is still a pin worth recording: it changes the answers.
  if (temp !== null && Number.isFinite(temp) && temp >= 0 && temp <= 2) e.temperature = temp;
  // A server on its own pins nothing — it only says where the pinned model runs.
  if (!Object.keys(e).length) return undefined;
  // No server named: fall back to the one the catalogue lists this model on.
  const nm = server || (e.model ? ctx.byModel.get(e.model) ?? null : null);
  if (nm) {
    e.server = nm;
    const s = ctx.servers.get(nm);
    if (s) {
      e.base_url = s.base_url;
      if (s.key_ref) e.api_key_ref = s.key_ref;
    } else {
      // Deleted or renamed between opening the form and pressing the button.
      // The run still goes ahead on the agent's own address, and this line is
      // the only way to tell that apart afterwards from never having picked one.
      logger.warn("pinned LLM server is not registered — agent config address used", { server: nm });
    }
  }
  return e;
}

/**
 * What a pin needs besides the numbers on screen: which servers exist, and
 * which one a bare model name means.
 *
 * Both snapshot paths take the same context, so a run started from the form and
 * one started with no selection at all resolve an address the same way. Built
 * once per run rather than per role — four roles would otherwise be four pairs
 * of the same two queries.
 */
export interface PinContext {
  servers: ServerMap;
  byModel: Map<string, string>;
}

export async function pinContext(conn?: OracleConnection): Promise<PinContext> {
  const [servers, models] = await Promise.all([
    serverMap(conn),
    (conn ? llmModelsOn(conn) : listLlmModels()).catch(() => [] as LlmModel[]),
  ]);
  return { servers, byModel: uniqueByName(models) };
}

/**
 * Model name → the server it is served from, for names that settle it alone.
 *
 * A saved role default (PTX_MODEL_MAS) holds a model *name* and nothing about
 * where it runs, so the server has to be worked back out of the catalogue. The
 * same name registered twice is exactly the case a name cannot settle — even
 * when one of the two rows has no server, since "no server" is itself an answer
 * (the agent's own address) and the two rows disagree. Those are left out and
 * fall through to the agent's config, as before the registry existed.
 */
function uniqueByName(models: LlmModel[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.llm_nm)) {
      out.delete(m.llm_nm);
      continue;
    }
    seen.add(m.llm_nm);
    if (m.server_nm) out.set(m.llm_nm, m.server_nm);
  }
  return out;
}

/** Serialise, treating "nothing pinned" as null rather than `{}`. That call goes
 * out on the agent's own config, and an empty object would read like "we pinned
 * something" to anyone looking at the stored value later. */
function serialize(out: Record<string, PinEntry>): string | null {
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * A run's own model selection as the JSON that gets staged and stamped.
 *
 * Reads nothing: the run tab renders every role and sends back what is on
 * screen, so this is a straight translation of what the user was looking at when
 * they pressed the button. Clearing a box therefore hands that role back to the
 * agent's config, which is the behaviour the screen shows.
 *
 * The same string is staged for the agent (PTX_CALL_MAS.MODEL_CTN) and stamped
 * on the run record (PTX_RUN_MAS.MODEL_CTN), so what a run claims and what it
 * actually ran under cannot drift apart.
 */
export function explicitSnapshot(
  sel: ModelSelection | null | undefined,
  ctx: PinContext,
): string | null {
  const out: Record<string, PinEntry> = {};
  for (const [role, p] of Object.entries(sel ?? {})) {
    const r = role.trim();
    // An unparseable role name can only be a client bug; it would reach the
    // agent as a key that matches no enum member and be ignored there anyway.
    if (!r || !ROLE_RE.test(r) || !p) continue;
    const e = pin(
      (p.model ?? "").trim(),
      typeof p.temperature === "number" ? p.temperature : null,
      (p.server ?? "").trim() || null,
      ctx,
    );
    if (e) out[r] = e;
  }
  return serialize(out);
}

/**
 * The saved role defaults as the same JSON — the fallback for a caller that
 * sends no selection of its own (anything outside the run tabs).
 *
 * Takes an open connection so the stamp can land in the same transaction as the
 * run row it describes. A lookup failure is null: this must never abort a run.
 */
export async function modelSnapshot(conn: OracleConnection): Promise<string | null> {
  let rows: ModelRole[];
  try {
    rows = await fetchAll(conn);
  } catch {
    return null;
  }
  const ctx = await pinContext(conn);
  const out: Record<string, PinEntry> = {};
  for (const m of rows) {
    const e = pin(m.model_nm, m.temperature, null, ctx);
    if (e) out[m.role_cd] = e;
  }
  return serialize(out);
}


/** :func:`modelSnapshot` on its own connection, for callers with none open.
 * Null (rather than throwing) when the DB is unavailable. */
export async function currentModelSnapshot(): Promise<string | null> {
  return readConn(modelSnapshot, null);
}

/** Trim to null — an empty box means "unset", which is what the agent reads as
 * "use the config default". */
function text(v: string | null | undefined, max: number, label: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > max) throw badRequest(`${label}이 너무 깁니다 (최대 ${max}자)`);
  return s;
}

/** Role names are join keys, not prose: no spaces, and short enough for the
 * column. The agent's enum values are plain identifiers. */
const ROLE_RE = /^[A-Za-z0-9_.-]+$/;

function roleCd(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("role 이름을 입력하세요");
  if (s.length > 30) throw badRequest("role 이름이 너무 깁니다 (최대 30자)");
  if (!ROLE_RE.test(s)) throw badRequest("role 이름에는 영문·숫자와 _ . - 만 쓸 수 있습니다");
  return s;
}

/** Add a role. Returns the full list so the caller needs no second read. */
export async function createModelRole(payload: ModelRoleCreate, actor: string): Promise<ModelRole[]> {
  const role = roleCd(payload.role_cd);
  const model = text(payload.model_nm, 200, `${role} 의 모델명`);

  return withConn(async (conn, oracle) => {
    // Checked before the insert so a duplicate reads as a sentence rather than
    // an ORA-00001 on UQ_PTX_MODEL_ROLE.
    const existing = await fetchAll(conn);
    if (existing.some((m) => m.role_cd === role)) throw conflict(`이미 있는 role 입니다: ${role}`);

    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_MODEL_MAS (ROLE_CD, MODEL_NM, USER_ID)
       VALUES (:role, :model, :actor) RETURNING MODEL_ID INTO :out_id`,
      { role, model, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_MODEL_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { role_cd: role, model_nm: model },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

/** Remove a role. The agent simply falls back to its own config for it. */
export async function deleteModelRole(role: string, actor: string): Promise<ModelRole[]> {
  const name = (role ?? "").trim();

  return withConn(async (conn) => {
    const before = (await fetchAll(conn)).find((m) => m.role_cd === name);
    if (!before) throw notFound(`등록되지 않은 role 입니다: ${name || "(빈 값)"}`);

    await conn.execute(`DELETE FROM PTX_MODEL_MAS WHERE ROLE_CD = :role`, { role: name });
    await writeAudit(conn, {
      targetTable: "PTX_MODEL_MAS",
      targetId: before.model_id,
      action: "DELETE",
      before: {
        role_cd: before.role_cd,
        model_nm: before.model_nm,
        temperature: before.temperature,
        description: before.description,
      },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}
