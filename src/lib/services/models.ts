import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { MODEL_COLS, insertReturningId, mapModelRole } from "@/lib/db/rows";
import type { ModelRole, ModelRoleCreate, ModelRoleUpdate } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_MODEL_MAS holds one row per LLM role the external agent defines in its
// config. PTX edits the model name; the agent reads the table by ROLE_CD and
// applies it. The DDL seeds the roles that exist today; adding one here is for
// when the agent's LLMModel enum grows. ROLE_CD is the whole contract — a name
// that does not match an enum value sits in the DB looking configured while the
// agent never reads it, so it is validated on the way in and a save against an
// unknown role is an error rather than a silent insert.

async function fetchAll(conn: OracleConnection): Promise<ModelRole[]> {
  const res = await conn.execute(`SELECT ${MODEL_COLS} FROM PTX_MODEL_MAS ORDER BY MODEL_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapModelRole);
}

export async function listModelRoles(): Promise<ModelRole[]> {
  return readConn(fetchAll, []);
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
