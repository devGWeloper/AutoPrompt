import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { MODEL_COLS, insertReturningId, mapModelRole } from "@/lib/db/rows";
import type { ModelRole, ModelRoleCreate, ModelRoleUpdate, ModelSelection } from "@/lib/types";
import { writeAudit } from "./audit";

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

/** Drop the empty halves and refuse a temperature that would change every answer
 * by accident. Returns undefined when nothing about the role was actually
 * pinned, which is different from `{}` — see :func:`explicitSnapshot`. */
function pin(model: string | null, temp: number | null): { model?: string; temperature?: number } | undefined {
  const e: { model?: string; temperature?: number } = {};
  if (model !== null && model !== "") e.model = model;
  // Temperature alone is still a pin worth recording: it changes the answers.
  if (temp !== null && Number.isFinite(temp) && temp >= 0 && temp <= 2) e.temperature = temp;
  return Object.keys(e).length ? e : undefined;
}

/** Serialise, treating "nothing pinned" as null rather than `{}`. That call goes
 * out on the agent's own config, and an empty object would read like "we pinned
 * something" to anyone looking at the stored value later. */
function serialize(out: Record<string, { model?: string; temperature?: number }>): string | null {
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
export function explicitSnapshot(sel: ModelSelection | null | undefined): string | null {
  const out: Record<string, { model?: string; temperature?: number }> = {};
  for (const [role, p] of Object.entries(sel ?? {})) {
    const r = role.trim();
    // An unparseable role name can only be a client bug; it would reach the
    // agent as a key that matches no enum member and be ignored there anyway.
    if (!r || !ROLE_RE.test(r) || !p) continue;
    const e = pin((p.model ?? "").trim(), typeof p.temperature === "number" ? p.temperature : null);
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
  const out: Record<string, { model?: string; temperature?: number }> = {};
  for (const m of rows) {
    const e = pin(m.model_nm, m.temperature);
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

function temperature(v: number | null | undefined, role: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2) {
    throw badRequest(`${role} 의 temperature 는 0 과 2 사이 숫자여야 합니다`);
  }
  return v;
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

/**
 * Save the editable fields of the given roles. Each item carries all three
 * fields — a missing one is stored as NULL, so the client sends the whole row.
 * One transaction: either every role in the batch lands or none does.
 */
export async function updateModelRoles(items: ModelRoleUpdate[], actor: string): Promise<ModelRole[]> {
  if (!items.length) throw badRequest("변경할 항목이 없습니다");

  return withConn(async (conn) => {
    const byRole = new Map((await fetchAll(conn)).map((m) => [m.role_cd, m]));

    for (const item of items) {
      const role = (item.role_cd ?? "").trim();
      const before = byRole.get(role);
      if (!before) throw notFound(`등록되지 않은 role 입니다: ${role || "(빈 값)"}`);

      const model = text(item.model_nm, 200, `${role} 의 모델명`);
      const descr = text(item.description, 500, `${role} 의 메모`);
      const temp = temperature(item.temperature, role);

      await conn.execute(
        `UPDATE PTX_MODEL_MAS
            SET MODEL_NM = :model, TEMPERATURE = :temp, DESC_CTN = :descr,
                USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
          WHERE ROLE_CD = :role`,
        { model, temp, descr, actor, role },
      );
      await writeAudit(conn, {
        targetTable: "PTX_MODEL_MAS",
        targetId: before.model_id,
        action: "UPDATE",
        before: {
          role_cd: role,
          model_nm: before.model_nm,
          temperature: before.temperature,
          description: before.description,
        },
        after: { role_cd: role, model_nm: model, temperature: temp, description: descr },
        createdBy: actor,
      });
    }

    return fetchAll(conn);
  }, { commit: true });
}
