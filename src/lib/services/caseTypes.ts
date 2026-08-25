import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http";
import { insertReturningId } from "@/lib/db/rows";
import type { CaseTypeInput, DatasetCategory } from "@/lib/types";
import { writeAudit } from "./audit";
import { requireDataset } from "./datasets";

// PTX_CASETYPE_MAS holds one dataset's folders — the groups its cases are split
// into. A case says which folder it is in with PTX_DATASET_DET.TYPE_CD, matched
// by name within the dataset.
//
// The folders are a list of their own rather than "whatever values the cases
// happen to carry", because an empty folder has to be able to exist: you make
// the folder, then fill it. Deriving them from the cases would make a folder
// appear with its first case and vanish with its last.
//
// No FK from PTX_DATASET_DET to here: deleting a folder must not delete the
// cases in it.

/** TYPE_CD's column default, and what the UI calls 폴더 없음 — never a folder. */
const RESERVED = "NORMAL";

/** Registered folders with their case counts, plus the values that exist only on
 * cases (NORMAL, and anything a CSV brought in). One list, because that is what
 * both the dataset sidebar and the run form need to show. */
async function fetchAll(conn: OracleConnection, datasetId: number): Promise<DatasetCategory[]> {
  const folders = await conn.execute(
    `SELECT TYPE_ID, TYPE_CD FROM PTX_CASETYPE_MAS WHERE DATASET_ID = :id ORDER BY TYPE_CD`,
    { id: datasetId },
  );
  // NVL: rows written before TYPE_CD had a default can hold NULL, and those are
  // 폴더 없음 like any other case that was never filed.
  const counts = await conn.execute(
    `SELECT NVL(TYPE_CD, 'NORMAL') AS TYPE_CD, COUNT(*) AS N
       FROM PTX_DATASET_DET
      WHERE DATASET_ID = :id
      GROUP BY NVL(TYPE_CD, 'NORMAL')`,
    { id: datasetId },
  );

  const byCode = new Map<string, number>();
  for (const r of (counts.rows ?? []) as Record<string, unknown>[]) {
    byCode.set(String(r.TYPE_CD), Number(r.N ?? 0));
  }

  const out: DatasetCategory[] = [];
  for (const r of (folders.rows ?? []) as Record<string, unknown>[]) {
    const cd = String(r.TYPE_CD);
    out.push({ type_id: Number(r.TYPE_ID), type_cd: cd, case_count: byCode.get(cd) ?? 0 });
    byCode.delete(cd);
  }
  // Leftovers: values sitting on cases with no folder to match. Listed so they
  // can be seen and moved rather than quietly filtered out of every view.
  const strays = [...byCode.entries()].filter(([cd]) => cd !== RESERVED).sort();
  for (const [cd, n] of strays) out.push({ type_id: null, type_cd: cd, case_count: n });
  // 폴더 없음 last: it is the leftover pile, not a folder someone made.
  const loose = byCode.get(RESERVED);
  if (loose) out.push({ type_id: null, type_cd: RESERVED, case_count: loose });
  return out;
}

export async function listDatasetCategories(datasetId: number): Promise<DatasetCategory[]> {
  await requireDataset(datasetId);
  return readConn((conn) => fetchAll(conn, datasetId), []);
}

function code(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) throw badRequest("폴더 이름을 입력하세요");
  if (s.length > 50) throw badRequest("폴더 이름이 너무 깁니다 (최대 50자)");
  if (s.toUpperCase() === RESERVED) throw badRequest("'NORMAL' 은 폴더 없음을 뜻하는 예약값입니다");
  return s;
}

async function folderName(
  conn: OracleConnection,
  datasetId: number,
  typeId: number,
): Promise<string | null> {
  const res = await conn.execute(
    `SELECT TYPE_CD FROM PTX_CASETYPE_MAS WHERE TYPE_ID = :tid AND DATASET_ID = :did`,
    { tid: typeId, did: datasetId },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? String(rows[0].TYPE_CD) : null;
}

export async function createDatasetCategory(
  datasetId: number,
  payload: CaseTypeInput,
  actor: string,
): Promise<DatasetCategory[]> {
  await requireDataset(datasetId);
  const cd = code(payload.type_cd);

  return withConn(async (conn, oracle) => {
    const existing = await fetchAll(conn, datasetId);
    // A stray of the same name is not a conflict: making the folder is exactly
    // how the cases already carrying that value get one.
    if (existing.some((t) => t.type_cd === cd && t.type_id !== null)) {
      throw conflict(`이미 있는 폴더입니다: ${cd}`);
    }
    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PTX_CASETYPE_MAS (DATASET_ID, TYPE_CD, USER_ID)
       VALUES (:did, :cd, :actor) RETURNING TYPE_ID INTO :out_id`,
      { did: datasetId, cd, actor },
    );
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { dataset_id: datasetId, type_cd: cd },
      createdBy: actor,
    });
    return fetchAll(conn, datasetId);
  }, { commit: true });
}

/** A rename carries the cases with it: a case names its folder with this same
 * string, so leaving them behind would empty the folder that was just renamed. */
export async function renameDatasetCategory(
  datasetId: number,
  typeId: number,
  payload: CaseTypeInput,
  actor: string,
): Promise<DatasetCategory[]> {
  await requireDataset(datasetId);
  const cd = code(payload.type_cd);

  return withConn(async (conn) => {
    const before = await folderName(conn, datasetId, typeId);
    if (before === null) throw notFound(`등록되지 않은 폴더입니다: ${typeId}`);
    if (before !== cd && (await fetchAll(conn, datasetId)).some((t) => t.type_cd === cd)) {
      throw conflict(`이미 있는 폴더입니다: ${cd}`);
    }

    await conn.execute(
      `UPDATE PTX_CASETYPE_MAS SET TYPE_CD = :cd, USER_ID = :actor, UPDATE_TM = SYSTIMESTAMP
        WHERE TYPE_ID = :tid`,
      { cd, actor, tid: typeId },
    );
    if (before !== cd) {
      await conn.execute(
        `UPDATE PTX_DATASET_DET SET TYPE_CD = :cd WHERE DATASET_ID = :did AND TYPE_CD = :old`,
        { cd, did: datasetId, old: before },
      );
    }
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: typeId,
      action: "UPDATE",
      before: { type_cd: before },
      after: { type_cd: cd },
      createdBy: actor,
    });
    return fetchAll(conn, datasetId);
  }, { commit: true });
}

/**
 * Remove a folder. Its cases are moved out to 폴더 없음 rather than left pointing
 * at a name nothing offers any more — deleting a folder must never look like
 * deleting the cases in it, and it must not hide them either.
 */
export async function deleteDatasetCategory(
  datasetId: number,
  typeId: number,
  actor: string,
): Promise<DatasetCategory[]> {
  await requireDataset(datasetId);
  return withConn(async (conn) => {
    const before = await folderName(conn, datasetId, typeId);
    if (before === null) throw notFound(`등록되지 않은 폴더입니다: ${typeId}`);

    const moved = await conn.execute(
      `UPDATE PTX_DATASET_DET SET TYPE_CD = 'NORMAL' WHERE DATASET_ID = :did AND TYPE_CD = :cd`,
      { did: datasetId, cd: before },
    );
    await conn.execute(`DELETE FROM PTX_CASETYPE_MAS WHERE TYPE_ID = :tid`, { tid: typeId });
    await writeAudit(conn, {
      targetTable: "PTX_CASETYPE_MAS",
      targetId: typeId,
      action: "DELETE",
      before: { type_cd: before },
      after: { moved_to_unfiled: moved.rowsAffected ?? 0 },
      createdBy: actor,
    });
    return fetchAll(conn, datasetId);
  }, { commit: true });
}
