import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { hasTable } from "@/lib/db/optionalColumn";
import { badRequest, conflict, notFound } from "@/lib/http";
import { LLMSVR_COLS, insertReturningId, mapLlmServer } from "@/lib/db/rows";
import type { LlmServer, LlmServerInput } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_LLMSVR_MAS is where a model's *address* lives. PTX_LLM_MAS used to hold
// model names alone, so picking a model on a run screen changed the name the
// agent was asked for but never the host it asked — every model resolved to the
// one base_url in the agent's own config. A model now points at a server here,
// and the run carries that server's URL along with the model name.
//
// KEY_REF is the *name* of the API key, not the key: an environment variable on
// the agent host (or an entry in the agent's own config), which the agent
// resolves at call time. The value never enters this database, because a run
// stamps its model config into PTX_RUN_MAS.MODEL_CTN and that string is copied
// on into the audit log and the CSV export — a key stored here would be
// duplicated in plaintext across all three. See docs/model-roles-agent.md.

const TABLE = "PTX_LLMSVR_MAS";

async function fetchAll(conn: OracleConnection): Promise<LlmServer[]> {
  // The registry arrives by migration (sql/migrate_llm_server.sql). Until it is
  // applied the settings page shows an empty section rather than ORA-00942.
  if (!(await hasTable(conn, TABLE))) return [];
  const res = await conn.execute(`SELECT ${LLMSVR_COLS} FROM ${TABLE} ORDER BY SERVER_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapLlmServer);
}

export async function listLlmServers(): Promise<LlmServer[]> {
  return readConn(fetchAll, []);
}

/** What a model may be assigned to: registered and active. */
export async function selectableLlmServers(): Promise<LlmServer[]> {
  return (await listLlmServers()).filter((s) => s.is_active === "Y");
}

export type ServerMap = Map<string, { base_url: string; key_ref: string | null }>;

/** SERVER_NM → the address behind it. A run sends the name, and this turns it
 * into what the agent needs; resolving at run time rather than storing the URL
 * in the pin means a server whose address changed is never called at the old
 * one. Takes an open connection so the lookup can share the run's transaction. */
export async function serverMap(conn?: OracleConnection): Promise<ServerMap> {
  const rows = conn ? await fetchAll(conn).catch(() => []) : await listLlmServers();
  return new Map(rows.map((s) => [s.server_nm, { base_url: s.base_url, key_ref: s.key_ref }]));
}

/** Guard for the write paths: a create against a missing table would otherwise
 * surface as a raw ORA error with no hint about what to do. */
async function requireTable(conn: OracleConnection): Promise<void> {
  if (!(await hasTable(conn, TABLE))) {
    throw badRequest("LLM 서버 테이블이 없습니다 — sql/migrate_llm_server.sql 을 먼저 적용하세요");
  }
}

function name(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("이름을 입력하세요");
  if (s.length > 100) throw badRequest("이름이 너무 깁니다 (최대 100자)");
  return s;
}

/** Same check the API registry does (endpoints.ts): a URL saved without a
 * scheme fails much later, on the agent's side, as a message about the model
 * rather than about this field. */
function baseUrl(v: string | null | undefined): string {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  if (!s) throw badRequest("Base URL 을 입력하세요");
  if (s.length > 500) throw badRequest("Base URL 이 너무 깁니다 (최대 500자)");
  if (!/^https?:\/\//i.test(s)) throw badRequest("Base URL 은 http:// 또는 https:// 로 시작해야 합니다");
  return s;
}

/** An environment-variable name, not a secret. Checked as an identifier partly
 * so a pasted key is rejected here instead of being stored: keys carry
 * characters this pattern does not allow. */
const KEY_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function keyRef(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 100) throw badRequest("키 이름이 너무 깁니다 (최대 100자)");
  if (!KEY_REF_RE.test(s)) {
    throw badRequest("키 이름에는 영문·숫자·_ 만 쓸 수 있습니다 (키 값이 아니라 환경변수 이름입니다)");
  }
  return s;
}

function memo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) throw badRequest("메모가 너무 깁니다 (최대 500자)");
  return s;
}

const yn = (v: "Y" | "N" | undefined): "Y" | "N" => (v === "N" ? "N" : "Y");

export async function createLlmServer(payload: LlmServerInput, actor: string): Promise<LlmServer[]> {
  const nm = name(payload.server_nm);
  const url = baseUrl(payload.base_url);
  const ref = keyRef(payload.key_ref);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn, oracle) => {
    await requireTable(conn);
    if ((await fetchAll(conn)).some((s) => s.server_nm === nm)) throw conflict(`이미 있는 이름입니다: ${nm}`);

    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO ${TABLE} (SERVER_NM, BASE_URL, KEY_REF, DESC_CTN, ACTIVE_YN, USER_ID)
       VALUES (:nm, :url, :ref, :descr, :active, :actor) RETURNING SERVER_ID INTO :out_id`,
      { nm, url, ref, descr: desc, active, actor },
    );
    await writeAudit(conn, {
      targetTable: TABLE,
      targetId: id,
      action: "CREATE",
      before: null,
      after: { server_nm: nm, base_url: url, key_ref: ref },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function updateLlmServer(
  id: number,
  payload: LlmServerInput,
  actor: string,
): Promise<LlmServer[]> {
  const nm = name(payload.server_nm);
  const url = baseUrl(payload.base_url);
  const ref = keyRef(payload.key_ref);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn) => {
    await requireTable(conn);
    const all = await fetchAll(conn);
    const before = all.find((s) => s.server_id === id);
    if (!before) throw notFound(`등록되지 않은 서버입니다: ${id}`);
    if (all.some((s) => s.server_nm === nm && s.server_id !== id)) {
      throw conflict(`이미 있는 이름입니다: ${nm}`);
    }

    await conn.execute(
      `UPDATE ${TABLE}
          SET SERVER_NM = :nm, BASE_URL = :url, KEY_REF = :ref, DESC_CTN = :descr,
              ACTIVE_YN = :active, USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE SERVER_ID = :id`,
      { nm, url, ref, descr: desc, active, actor, id },
    );
    await writeAudit(conn, {
      targetTable: TABLE,
      targetId: id,
      action: "UPDATE",
      before: { server_nm: before.server_nm, base_url: before.base_url, key_ref: before.key_ref },
      after: { server_nm: nm, base_url: url, key_ref: ref },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function deleteLlmServer(id: number, actor: string): Promise<LlmServer[]> {
  return withConn(async (conn) => {
    await requireTable(conn);
    const before = (await fetchAll(conn)).find((s) => s.server_id === id);
    if (!before) throw notFound(`등록되지 않은 서버입니다: ${id}`);

    // The FK would refuse this anyway; said here it names the models in the way
    // ORA-02292 does not.
    const used = await conn.execute(
      `SELECT COUNT(*) AS N FROM PTX_LLM_MAS WHERE SERVER_ID = :id`,
      { id },
    );
    const n = Number(((used.rows ?? [])[0] as { N?: unknown } | undefined)?.N ?? 0);
    if (n > 0) throw conflict(`이 서버를 쓰는 모델이 ${n}개 있습니다 — 모델을 먼저 옮기거나 지우세요`);

    await conn.execute(`DELETE FROM ${TABLE} WHERE SERVER_ID = :id`, { id });
    await writeAudit(conn, {
      targetTable: TABLE,
      targetId: id,
      action: "DELETE",
      before: { server_nm: before.server_nm, base_url: before.base_url },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}
