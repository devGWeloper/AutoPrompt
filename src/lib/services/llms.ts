import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { hasColumn } from "@/lib/db/optionalColumn";
import { badRequest, conflict, notFound } from "@/lib/http";
import { LLM_COLS, LLM_JOIN_COLS, insertReturningId, mapLlmModel } from "@/lib/db/rows";
import type { LlmModel, LlmModelInput } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_LLM_MAS is the list of models a role may be set to. Roles
// (PTX_MODEL_MAS) say *which* model each part of the agent runs; this says which
// models exist to choose from, so the run screen offers a list instead of a text
// box where a typo silently pins a model that does not exist.
//
// A model belongs to a server (PTX_LLMSVR_MAS), because the same model name can
// be served at more than one address and the address is half of what "use this
// model" means. SERVER_ID null = no address pinned: the agent calls the base_url
// in its own config, which is how this worked before the server registry.

/** SERVER_ID arrives by migration (sql/migrate_llm_server.sql). Before it, the
 * list still works — every model simply has no server. */
async function joined(conn: OracleConnection): Promise<boolean> {
  return hasColumn(conn, "PTX_LLM_MAS", "SERVER_ID");
}

async function fetchAll(conn: OracleConnection): Promise<LlmModel[]> {
  const res = (await joined(conn))
    ? await conn.execute(
        `SELECT ${LLM_JOIN_COLS}
           FROM PTX_LLM_MAS l LEFT JOIN PTX_LLMSVR_MAS s ON s.SERVER_ID = l.SERVER_ID
          ORDER BY l.LLM_ID`,
      )
    : await conn.execute(`SELECT ${LLM_COLS} FROM PTX_LLM_MAS ORDER BY LLM_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapLlmModel);
}

export async function listLlmModels(): Promise<LlmModel[]> {
  return readConn(fetchAll, []);
}

/** The same list on an open connection — for the snapshot builder, which has to
 * work out which server a saved role default is served from. */
export async function llmModelsOn(conn: OracleConnection): Promise<LlmModel[]> {
  return fetchAll(conn);
}

function name(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("모델명을 입력하세요");
  if (s.length > 200) throw badRequest("모델명이 너무 깁니다 (최대 200자)");
  return s;
}

/** The server this model is served from. Checked against the registry rather
 * than trusted — the FK would reject an unknown id with an ORA number that says
 * nothing about which field was wrong. */
async function serverId(
  conn: OracleConnection,
  v: number | null | undefined,
): Promise<number | null> {
  if (v === null || v === undefined) return null;
  if (!(await joined(conn))) {
    throw badRequest("LLM 서버 기능이 없는 DB 입니다 — sql/migrate_llm_server.sql 을 먼저 적용하세요");
  }
  const res = await conn.execute(`SELECT SERVER_ID FROM PTX_LLMSVR_MAS WHERE SERVER_ID = :id`, {
    id: v,
  });
  if (!(res.rows ?? []).length) throw notFound(`등록되지 않은 서버입니다: ${v}`);
  return v;
}

function memo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) throw badRequest("메모가 너무 깁니다 (최대 500자)");
  return s;
}

const yn = (v: "Y" | "N" | undefined): "Y" | "N" => (v === "N" ? "N" : "Y");

/** 같은 모델명이 서버마다 떠 있을 수 있으므로 중복은 (모델명, 서버) 한 쌍으로
 * 본다. Oracle 의 UNIQUE 는 NULL 끼리를 서로 다르게 보므로 '서버 미지정' 끼리의
 * 중복은 제약이 막아 주지 않는다 — 여기서 막는다. */
function dupText(nm: string, sid: number | null, list: LlmModel[]): string | null {
  const hit = list.find((m) => m.llm_nm === nm && m.server_id === sid);
  if (!hit) return null;
  return sid === null ? `이미 있는 모델입니다: ${nm}` : `그 서버에 이미 있는 모델입니다: ${nm}`;
}

export async function createLlmModel(payload: LlmModelInput, actor: string): Promise<LlmModel[]> {
  const nm = name(payload.llm_nm);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn, oracle) => {
    const sid = await serverId(conn, payload.server_id);
    const dup = dupText(nm, sid, await fetchAll(conn));
    if (dup) throw conflict(dup);

    const withServer = await joined(conn);
    const id = await insertReturningId(
      conn,
      oracle,
      withServer
        ? `INSERT INTO PTX_LLM_MAS (LLM_NM, SERVER_ID, DESC_CTN, ACTIVE_YN, USER_ID)
           VALUES (:nm, :sid, :descr, :active, :actor) RETURNING LLM_ID INTO :out_id`
        : `INSERT INTO PTX_LLM_MAS (LLM_NM, DESC_CTN, ACTIVE_YN, USER_ID)
           VALUES (:nm, :descr, :active, :actor) RETURNING LLM_ID INTO :out_id`,
      withServer
        ? { nm, sid, descr: desc, active, actor }
        : { nm, descr: desc, active, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_LLM_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { llm_nm: nm, server_id: sid },
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
    const sid = await serverId(conn, payload.server_id);
    const all = await fetchAll(conn);
    const before = all.find((m) => m.llm_id === id);
    if (!before) throw notFound(`등록되지 않은 모델입니다: ${id}`);
    const dup = dupText(nm, sid, all.filter((m) => m.llm_id !== id));
    if (dup) throw conflict(dup);

    const withServer = await joined(conn);
    await conn.execute(
      `UPDATE PTX_LLM_MAS
          SET LLM_NM = :nm, ${withServer ? "SERVER_ID = :sid, " : ""}DESC_CTN = :descr, ACTIVE_YN = :active,
              USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE LLM_ID = :id`,
      withServer
        ? { nm, sid, descr: desc, active, actor, id }
        : { nm, descr: desc, active, actor, id },
    );
    await writeAudit(conn, {
      targetTable: "PTX_LLM_MAS",
      targetId: id,
      action: "UPDATE",
      before: { llm_nm: before.llm_nm, server_id: before.server_id },
      after: { llm_nm: nm, server_id: sid },
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
      before: { llm_nm: before.llm_nm, server_id: before.server_id },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}
