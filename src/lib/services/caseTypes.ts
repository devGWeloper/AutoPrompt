import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { CASETYPE_COLS, insertReturningId, mapCaseType } from "@/lib/db/rows";
import type { CaseType, CaseTypeInput } from "@/lib/types";
import { writeAudit } from "./audit";

// PTX_CASETYPE_MAS is the list a case's TYPE_CD may be set to. Categories are
// decided up front and then picked, so the dataset screen offers this list
// rather than a text box where two spellings of the same category quietly split
// a dataset in half.
//
// No FK from PTX_DATASET_DET: like the other settings tables, removing an entry
// here must not rewrite or delete cases that already carry it. Such a case keeps
// its value and the dataset screen shows it as 목록에 없음.

/** The column default, and what the UI means by 미분류 — never a list entry. */
const RESERVED = "NORMAL";

async function fetchAll(conn: OracleConnection): Promise<CaseType[]> {
  // CASE_CNT rides along: the settings list says what a delete would strand, and
  // it is the number that tells you whether a category is being used at all.
  const res = await conn.execute(
    `SELECT ${CASETYPE_COLS},
            (SELECT COUNT(*) FROM PTX_DATASET_DET d WHERE d.TYPE_CD = t.TYPE_CD) AS CASE_CNT
       FROM PTX_CASETYPE_MAS t
      ORDER BY t.TYPE_CD`,
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapCaseType);
}

export async function listCaseTypes(): Promise<CaseType[]> {
  return readConn(fetchAll, []);
}

function code(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("분류명을 입력하세요");
  if (s.length > 50) throw badRequest("분류명이 너무 깁니다 (최대 50자)");
  if (s.toUpperCase() === RESERVED) throw badRequest(`'${RESERVED}' 은 미분류를 뜻하는 예약값입니다`);
  return s;
}

function memo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) throw badRequest("메모가 너무 깁니다 (최대 500자)");
  return s;
}

const yn = (v: "Y" | "N" | undefined): "Y" | "N" => (v === "N" ? "N" : "Y");

export async function createCaseType(payload: CaseTypeInput, actor: string): Promise<CaseType[]> {
  const cd = code(payload.type_cd);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn, oracle) => {
    if ((await fetchAll(conn)).some((t) => t.type_cd === cd)) throw conflict(`이미 있는 분류입니다: ${cd}`);

    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_CASETYPE_MAS (TYPE_CD, DESC_CTN, ACTIVE_YN, USER_ID)
       VALUES (:cd, :descr, :active, :actor) RETURNING TYPE_ID INTO :out_id`,
      { cd, descr: desc, active, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { type_cd: cd },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

/** A rename carries the cases with it: the category on a case is this same
 * string, so leaving them behind would strand every case under the old name. */
export async function updateCaseType(
  id: number,
  payload: CaseTypeInput,
  actor: string,
): Promise<CaseType[]> {
  const cd = code(payload.type_cd);
  const desc = memo(payload.description);
  const active = yn(payload.is_active);

  return withConn(async (conn) => {
    const all = await fetchAll(conn);
    const before = all.find((t) => t.type_id === id);
    if (!before) throw notFound(`등록되지 않은 분류입니다: ${id}`);
    if (all.some((t) => t.type_cd === cd && t.type_id !== id)) throw conflict(`이미 있는 분류입니다: ${cd}`);

    await conn.execute(
      `UPDATE PTX_CASETYPE_MAS
          SET TYPE_CD = :cd, DESC_CTN = :descr, ACTIVE_YN = :active,
              USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE TYPE_ID = :id`,
      { cd, descr: desc, active, actor, id },
    );
    if (before.type_cd !== cd) {
      await conn.execute(`UPDATE PTX_DATASET_DET SET TYPE_CD = :cd WHERE TYPE_CD = :old`, {
        cd,
        old: before.type_cd,
      });
    }
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: id,
      action: "UPDATE",
      before: { type_cd: before.type_cd },
      after: { type_cd: cd, moved_cases: before.type_cd !== cd ? before.case_count : 0 },
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}

export async function deleteCaseType(id: number, actor: string): Promise<CaseType[]> {
  return withConn(async (conn) => {
    const before = (await fetchAll(conn)).find((t) => t.type_id === id);
    if (!before) throw notFound(`등록되지 않은 분류입니다: ${id}`);

    await conn.execute(`DELETE FROM PTX_CASETYPE_MAS WHERE TYPE_ID = :id`, { id });
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: id,
      action: "DELETE",
      before: { type_cd: before.type_cd, case_count: before.case_count },
      after: null,
      createdBy: actor,
    });
    return fetchAll(conn);
  }, { commit: true });
}
