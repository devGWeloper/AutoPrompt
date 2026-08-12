import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, notFound } from "@/lib/http";
import { MODEL_COLS, mapModelRole } from "@/lib/db/rows";
import type { ModelRole, ModelRoleUpdate } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_MODEL_MAS holds one row per LLM role the external agent defines in its
// config. PTX edits the model name; the agent reads the table by ROLE_CD and
// applies it. Rows are never created or deleted here — the DDL seeds them, so a
// role that is not in the table is a mismatch worth an error rather than an
// insert (a typo'd role would otherwise sit in the DB looking configured while
// the agent never reads it).

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
