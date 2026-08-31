import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { getAgentConfig } from "@/lib/config";
import { badRequest, conflict, notFound } from "@/lib/http";
import { ENDPOINT_COLS, insertReturningId, mapEndpoint } from "@/lib/db/rows";
import type { Endpoint, EndpointHeader, EndpointInput } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_ENDPOINT_MAS is the list of external APIs a run may call. The run screens
// pick from it instead of taking a typed URL, so a credential is entered once
// here rather than pasted into a form on every call.
//
// config.yml 의 agent.a / agent.b 는 사라지지 않고 "등록된 것이 하나도 없을 때"
// 의 기본값으로 남는다 — DB 없이 뜬 화면이 아무것도 고를 수 없는 막다른 길이
// 되지 않도록. 그 둘은 음수 id 로 나가고 편집·삭제 대상이 아니다.
export const CONFIG_ENDPOINT_A = -1;
export const CONFIG_ENDPOINT_B = -2;

function configEndpoint(id: number): Endpoint | null {
  const cfg = getAgentConfig();
  const side = id === CONFIG_ENDPOINT_B ? cfg.b : cfg.a;
  const url = (side.url ?? "").trim();
  if (!url) return null;
  return {
    endpoint_id: id,
    endpoint_nm: id === CONFIG_ENDPOINT_B ? "config.yml · B" : "config.yml · A",
    endpoint_url: url,
    headers: side.headers.filter((h) => h.name.trim() !== ""),
    description: null,
    is_active: "Y",
    updated_by: "config",
    updated_dt: null,
    created_dt: "",
  };
}

/** config.yml 에 적혀 있는 엔드포인트들 — 등록 목록이 비었을 때만 쓰인다. */
function configEndpoints(): Endpoint[] {
  return [configEndpoint(CONFIG_ENDPOINT_A), configEndpoint(CONFIG_ENDPOINT_B)].filter(
    (e): e is Endpoint => e !== null,
  );
}

async function fetchAll(conn: OracleConnection): Promise<Endpoint[]> {
  const res = await conn.execute(`SELECT ${ENDPOINT_COLS} FROM PTX_ENDPOINT_MAS ORDER BY ENDPOINT_ID`);
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapEndpoint);
}

/** Everything the settings page edits. */
export async function listEndpoints(): Promise<Endpoint[]> {
  return readConn(fetchAll, []);
}

/** What a run may choose from: registered and active, or the config fallback. */
export async function selectableEndpoints(): Promise<Endpoint[]> {
  const rows = (await listEndpoints()).filter((e) => e.is_active === "Y");
  return rows.length ? rows : configEndpoints();
}

/** The URL + headers a chosen endpoint calls with. Null when the id is unknown,
 * which the caller turns into a plain error rather than a silent config call. */
export async function resolveEndpoint(
  id: number | null | undefined,
): Promise<{ name: string; url: string; headers: EndpointHeader[] } | null> {
  if (id === null || id === undefined) return null;
  if (id < 0) {
    const e = configEndpoint(id);
    return e ? { name: e.endpoint_nm, url: e.endpoint_url, headers: e.headers } : null;
  }
  const found = (await listEndpoints()).find((e) => e.endpoint_id === id);
  // 이름도 같이 나간다 — 실행 행이 이걸 스냅샷으로 적어 두고, 기록 목록이 '어느
  // API 로 보냈나'를 그 이름으로 말한다. 등록 목록이 나중에 바뀌어도 지난 실행이
  // 가리키던 곳은 그대로 남아야 한다 (DATASET_NM 과 같은 이유).
  return found
    ? { name: found.endpoint_nm, url: found.endpoint_url, headers: found.headers }
    : null;
}

function name(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("이름을 입력하세요");
  if (s.length > 100) throw badRequest("이름이 너무 깁니다 (최대 100자)");
  return s;
}

/** Scheme is checked here rather than at call time: a URL saved without one
 * fails on the wire much later, with a message about fetch instead of about
 * this field. */
function url(v: string | null | undefined): string {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  if (!s) throw badRequest("URL 을 입력하세요");
  if (s.length > 500) throw badRequest("URL 이 너무 깁니다 (최대 500자)");
  if (!/^https?:\/\//i.test(s)) throw badRequest("URL 은 http:// 또는 https:// 로 시작해야 합니다");
  return s;
}

/** Blank rows are dropped — an empty name is an empty row in the editor, not a
 * header the user means to send. */
function headers(v: EndpointHeader[] | null | undefined): string | null {
  const list = (v ?? [])
    .map((h) => ({ name: (h?.name ?? "").trim(), value: (h?.value ?? "").trim() }))
    .filter((h) => h.name !== "");
  if (!list.length) return null;
  const json = JSON.stringify(list);
  if (json.length > 4000) throw badRequest("헤더가 너무 깁니다");
  return json;
}

function memo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) throw badRequest("메모가 너무 깁니다 (최대 500자)");
  return s;
}

const yn = (v: "Y" | "N" | undefined): "Y" | "N" => (v === "N" ? "N" : "Y");

export async function createEndpoint(payload: EndpointInput, actor: string): Promise<Endpoint[]> {
  const nm = name(payload.endpoint_nm);
  const u = url(payload.endpoint_url);
  const hdr = headers(payload.headers);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn, oracle) => {
    const existing = await fetchAll(conn);
    if (existing.some((e) => e.endpoint_nm === nm)) throw conflict(`이미 있는 이름입니다: ${nm}`);

    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_ENDPOINT_MAS (ENDPOINT_NM, ENDPOINT_URL, HEADER_CTN, DESC_CTN, ACTIVE_YN, USER_ID)
       VALUES (:nm, :u, :hdr, :descr, :active, :actor) RETURNING ENDPOINT_ID INTO :out_id`,
      { nm, u, hdr, descr: desc, active, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_ENDPOINT_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { endpoint_nm: nm, endpoint_url: u },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function updateEndpoint(
  id: number,
  payload: EndpointInput,
  actor: string,
): Promise<Endpoint[]> {
  const nm = name(payload.endpoint_nm);
  const u = url(payload.endpoint_url);
  const hdr = headers(payload.headers);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn) => {
    const all = await fetchAll(conn);
    const before = all.find((e) => e.endpoint_id === id);
    if (!before) throw notFound(`등록되지 않은 API입니다: ${id}`);
    if (all.some((e) => e.endpoint_nm === nm && e.endpoint_id !== id)) {
      throw conflict(`이미 있는 이름입니다: ${nm}`);
    }

    await conn.execute(
      `UPDATE PTX_ENDPOINT_MAS
          SET ENDPOINT_NM = :nm, ENDPOINT_URL = :u, HEADER_CTN = :hdr, DESC_CTN = :descr,
              ACTIVE_YN = :active, USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE ENDPOINT_ID = :id`,
      { nm, u, hdr, descr: desc, active, actor, id },
    );
    await writeAudit(conn, {
      targetTable: "PTX_ENDPOINT_MAS",
      targetId: id,
      action: "UPDATE",
      before: { endpoint_nm: before.endpoint_nm, endpoint_url: before.endpoint_url },
      after: { endpoint_nm: nm, endpoint_url: u },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function deleteEndpoint(id: number, actor: string): Promise<Endpoint[]> {
  return withConn(async (conn) => {
    const before = (await fetchAll(conn)).find((e) => e.endpoint_id === id);
    if (!before) throw notFound(`등록되지 않은 API입니다: ${id}`);

    await conn.execute(`DELETE FROM PTX_ENDPOINT_MAS WHERE ENDPOINT_ID = :id`, { id });
    await writeAudit(conn, {
      targetTable: "PTX_ENDPOINT_MAS",
      targetId: id,
      action: "DELETE",
      before: { endpoint_nm: before.endpoint_nm, endpoint_url: before.endpoint_url },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

/** Header values are credentials. The run screens only need to know *which*
 * header carries the key and roughly which key it is, so the value is masked on
 * the way out; the settings editor is the one place that gets it in full. */
function maskValue(v: string): string {
  const s = v ?? "";
  if (!s) return "";
  return s.length <= 8 ? "••••" : `••••${s.slice(-4)}`;
}

export function maskEndpointHeaders(list: Endpoint[]): Endpoint[] {
  return list.map((e) => ({
    ...e,
    headers: e.headers.map((h) => ({ name: h.name, value: maskValue(h.value) })),
  }));
}
