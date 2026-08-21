import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { LLM_COLS, insertReturningId, mapLlmModel } from "@/lib/db/rows";
import type { LlmModel, LlmModelInput } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_LLM_MAS is the list of model names a role may be set to. Roles
// (PTX_MODEL_MAS) say *which* model each part of the agent runs; this says which
// models exist to choose from, so the run screen offers a list instead of a text
// box where a typo silently pins a model that does not exist.

async function fetchAll(conn: OracleConnection): Promise<LlmModel[]> {
  const res = await conn.execute(`SELECT ${LLM_COLS} FROM PTX_LLM_MAS ORDER BY LLM_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapLlmModel);
}

export async function listLlmModels(): Promise<LlmModel[]> {
  return readConn(fetchAll, []);
}

function name(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("모델명을 입력하세요");
  if (s.length > 200) throw badRequest("모델명이 너무 깁니다 (최대 200자)");
  return s;
}

function memo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) throw badRequest("메모가 너무 깁니다 (최대 500자)");
  return s;
}

const yn = (v: "Y" | "N" | undefined): "Y" | "N" => (v === "N" ? "N" : "Y");

export async function createLlmModel(payload: LlmModelInput, actor: string): Promise<LlmModel[]> {
  const nm = name(payload.llm_nm);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn, oracle) => {
    if ((await fetchAll(conn)).some((m) => m.llm_nm === nm)) throw conflict(`이미 있는 모델입니다: ${nm}`);

    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_LLM_MAS (LLM_NM, DESC_CTN, ACTIVE_YN, USER_ID)
       VALUES (:nm, :descr, :active, :actor) RETURNING LLM_ID INTO :out_id`,
      { nm, descr: desc, active, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_LLM_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { llm_nm: nm },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function updateLlmModel(
  id: number,
  payload: LlmModelInput,
  actor: string,
): Promise<LlmModel[]> {
  const nm = name(payload.llm_nm);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn) => {
    const all = await fetchAll(conn);
    const before = all.find((m) => m.llm_id === id);
    if (!before) throw notFound(`등록되지 않은 모델입니다: ${id}`);
    if (all.some((m) => m.llm_nm === nm && m.llm_id !== id)) throw conflict(`이미 있는 모델입니다: ${nm}`);

    await conn.execute(
      `UPDATE PTX_LLM_MAS
          SET LLM_NM = :nm, DESC_CTN = :descr, ACTIVE_YN = :active,
              USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE LLM_ID = :id`,
      { nm, descr: desc, active, actor, id },
    );
    await writeAudit(conn, {
      targetTable: "PTX_LLM_MAS",
      targetId: id,
      action: "UPDATE",
      before: { llm_nm: before.llm_nm },
      after: { llm_nm: nm },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function deleteLlmModel(id: number, actor: string): Promise<LlmModel[]> {
  return withConn(async (conn) => {
    const before = (await fetchAll(conn)).find((m) => m.llm_id === id);
    if (!before) throw notFound(`등록되지 않은 모델입니다: ${id}`);

    await conn.execute(`DELETE FROM PTX_LLM_MAS WHERE LLM_ID = :id`, { id });
    await writeAudit(conn, {
      targetTable: "PTX_LLM_MAS",
      targetId: id,
      action: "DELETE",
      before: { llm_nm: before.llm_nm },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}
