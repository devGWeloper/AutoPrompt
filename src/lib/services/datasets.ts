import { readConn, withConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, notFound } from "@/lib/http";
import {
  CASE_COLS,
  DATASET_COLS,
  insertReturningId,
  mapCase,
  mapDataset,
} from "@/lib/db/rows";
import type {
  CaseCreate,
  CaseUpdate,
  CsvUploadResult,
  Dataset,
  DatasetCreate,
  DatasetDetail,
  DatasetUpdate,
  TestCase,
} from "@/lib/types";
import { writeAudit } from "./audit";

// ---- datasets ----

export async function listFlowDatasets(): Promise<Dataset[]> {
  return readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT ${DATASET_COLS} FROM PM_TEST_DATASET WHERE IS_ACTIVE = 'Y' ORDER BY CREATED_DT DESC`,
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapDataset);
  }, []);
}

async function fetchDataset(conn: OracleConnection, id: number): Promise<Dataset | null> {
  const res = await conn.execute(`SELECT ${DATASET_COLS} FROM PM_TEST_DATASET WHERE DATASET_ID = :id`, { id });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapDataset(rows[0]) : null;
}

async function countCases(conn: OracleConnection, id: number): Promise<number> {
  const res = await conn.execute(`SELECT COUNT(*) AS N FROM PM_TEST_CASE WHERE DATASET_ID = :id`, { id });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return Number(rows[0]?.N ?? 0);
}

export async function getDatasetDetail(id: number): Promise<DatasetDetail> {
  const detail = await readConn(async (conn) => {
    const ds = await fetchDataset(conn, id);
    if (!ds) return null;
    return { ...ds, case_count: await countCases(conn, id) } as DatasetDetail;
  }, null);
  if (detail === null) throw notFound("dataset not found");
  return detail;
}

export async function createFlowDataset(payload: DatasetCreate, createdBy: string): Promise<DatasetDetail> {
  return withConn(async (conn, oracle) => {
    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PM_TEST_DATASET (DATASET_NM, DESCRIPTION, IS_ACTIVE, CREATED_BY)
       VALUES (:nm, :descr, 'Y', :cby) RETURNING DATASET_ID INTO :out_id`,
      { nm: payload.dataset_nm, descr: payload.description ?? null, cby: createdBy },
    );
    await writeAudit(conn, {
      targetTable: "PM_TEST_DATASET",
      targetId: id,
      action: "CREATE",
      before: null,
      after: { dataset_id: id, dataset_nm: payload.dataset_nm },
      createdBy,
    });
    const ds = (await fetchDataset(conn, id))!;
    return { ...ds, case_count: 0 };
  }, { commit: true });
}

export async function updateDataset(id: number, payload: DatasetUpdate, actor: string): Promise<DatasetDetail> {
  return withConn(async (conn) => {
    const before = await fetchDataset(conn, id);
    if (!before) throw notFound("dataset not found");

    const sets: string[] = [];
    const binds: Record<string, unknown> = { id };
    const applied: Record<string, unknown> = {};
    if (payload.dataset_nm !== undefined) {
      sets.push("DATASET_NM = :nm");
      binds.nm = payload.dataset_nm;
      applied.dataset_nm = payload.dataset_nm;
    }
    if (payload.description !== undefined) {
      sets.push("DESCRIPTION = :descr");
      binds.descr = payload.description;
      applied.description = payload.description;
    }
    if (payload.is_active !== undefined) {
      sets.push("IS_ACTIVE = :act");
      binds.act = payload.is_active;
      applied.is_active = payload.is_active;
    }
    if (sets.length) {
      await conn.execute(`UPDATE PM_TEST_DATASET SET ${sets.join(", ")} WHERE DATASET_ID = :id`, binds);
    }
    await writeAudit(conn, {
      targetTable: "PM_TEST_DATASET",
      targetId: id,
      action: "UPDATE",
      before: { dataset_nm: before.dataset_nm, description: before.description, is_active: before.is_active },
      after: applied,
      createdBy: actor,
    });
    const ds = (await fetchDataset(conn, id))!;
    return { ...ds, case_count: await countCases(conn, id) };
  }, { commit: true });
}

export async function deleteDataset(id: number, actor: string): Promise<void> {
  await withConn(async (conn) => {
    const before = await fetchDataset(conn, id);
    if (!before) throw notFound("dataset not found");

    // FK order: results → (runs, cases) → dataset.
    await conn.execute(
      `DELETE FROM PM_RAGAS_RESULT
        WHERE RAGAS_RUN_ID IN (SELECT RAGAS_RUN_ID FROM PM_RAGAS_RUN WHERE DATASET_ID = :id)
           OR CASE_ID IN (SELECT CASE_ID FROM PM_TEST_CASE WHERE DATASET_ID = :id)`,
      { id },
    );
    await conn.execute(`DELETE FROM PM_RAGAS_RUN WHERE DATASET_ID = :id`, { id });
    await conn.execute(`DELETE FROM PM_TEST_CASE WHERE DATASET_ID = :id`, { id });
    await conn.execute(`DELETE FROM PM_TEST_DATASET WHERE DATASET_ID = :id`, { id });

    await writeAudit(conn, {
      targetTable: "PM_TEST_DATASET",
      targetId: id,
      action: "DELETE",
      before: { dataset_id: id, dataset_nm: before.dataset_nm },
      after: null,
      createdBy: actor,
    });
  }, { commit: true });
}

// ---- cases ----

export async function requireDataset(id: number): Promise<void> {
  const ok = await readConn(async (conn) => (await fetchDataset(conn, id)) !== null, false);
  if (!ok) throw notFound("dataset not found");
}

export async function listCases(datasetId: number): Promise<TestCase[]> {
  await requireDataset(datasetId);
  return readConn(async (conn) => {
    const res = await conn.execute(
      `SELECT ${CASE_COLS} FROM PM_TEST_CASE WHERE DATASET_ID = :id ORDER BY CASE_ID ASC`,
      { id: datasetId },
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapCase);
  }, []);
}

async function fetchCase(conn: OracleConnection, datasetId: number, caseId: number): Promise<TestCase | null> {
  const res = await conn.execute(
    `SELECT ${CASE_COLS} FROM PM_TEST_CASE WHERE CASE_ID = :cid AND DATASET_ID = :did`,
    { cid: caseId, did: datasetId },
  );
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapCase(rows[0]) : null;
}

export async function createCase(datasetId: number, payload: CaseCreate, createdBy: string): Promise<TestCase> {
  await requireDataset(datasetId);
  return withConn(async (conn, oracle) => {
    const id = await insertReturningId(
      conn,
      oracle,
      `INSERT INTO PM_TEST_CASE (DATASET_ID, INPUT_DATA, EXPECTED_OUTPUT, EVAL_CRITERIA, CASE_TYPE, CREATED_BY)
       VALUES (:did, :input, :expected, :crit, :ctype, :cby) RETURNING CASE_ID INTO :out_id`,
      {
        did: datasetId,
        input: payload.input_data,
        expected: payload.expected_output ?? null,
        crit: payload.eval_criteria ?? null,
        ctype: payload.case_type ?? "NORMAL",
        cby: createdBy,
      },
    );
    return (await fetchCase(conn, datasetId, id))!;
  }, { commit: true });
}

export async function updateCase(datasetId: number, caseId: number, payload: CaseUpdate): Promise<TestCase> {
  return withConn(async (conn) => {
    const existing = await fetchCase(conn, datasetId, caseId);
    if (!existing) throw notFound("test case not found");
    const sets: string[] = [];
    const binds: Record<string, unknown> = { cid: caseId };
    if (payload.input_data !== undefined) {
      sets.push("INPUT_DATA = :input");
      binds.input = payload.input_data;
    }
    if (payload.expected_output !== undefined) {
      sets.push("EXPECTED_OUTPUT = :expected");
      binds.expected = payload.expected_output;
    }
    if (payload.eval_criteria !== undefined) {
      sets.push("EVAL_CRITERIA = :crit");
      binds.crit = payload.eval_criteria;
    }
    if (payload.case_type !== undefined) {
      sets.push("CASE_TYPE = :ctype");
      binds.ctype = payload.case_type;
    }
    if (sets.length) {
      await conn.execute(`UPDATE PM_TEST_CASE SET ${sets.join(", ")} WHERE CASE_ID = :cid`, binds);
    }
    return (await fetchCase(conn, datasetId, caseId))!;
  }, { commit: true });
}

export async function deleteCase(datasetId: number, caseId: number): Promise<void> {
  await withConn(async (conn) => {
    const existing = await fetchCase(conn, datasetId, caseId);
    if (!existing) throw notFound("test case not found");
    await conn.execute(`DELETE FROM PM_TEST_CASE WHERE CASE_ID = :cid`, { cid: caseId });
  }, { commit: true });
}

// ---- CSV import ----

const CSV_COLUMNS = ["input_json", "expected_output", "eval_criteria", "case_type"];

/** Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function importCsv(datasetId: number, fileText: string, createdBy: string): Promise<CsvUploadResult> {
  await requireDataset(datasetId);
  // Strip a UTF-8 BOM if present.
  const text = fileText.charCodeAt(0) === 0xfeff ? fileText.slice(1) : fileText;
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) throw badRequest(`CSV must have header columns: ${CSV_COLUMNS.join(", ")}`);

  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  if (idx("input_json") === -1) {
    throw badRequest(`CSV must have header columns: ${CSV_COLUMNS.join(", ")}`);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  await withConn(async (conn) => {
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (name: string) => {
        const i = idx(name);
        return i >= 0 && i < cells.length ? cells[i].trim() : "";
      };
      const inputData = get("input_json");
      if (!inputData) {
        skipped++;
        errors.push(`row ${r + 1}: empty input_json`);
        continue;
      }
      await conn.execute(
        `INSERT INTO PM_TEST_CASE (DATASET_ID, INPUT_DATA, EXPECTED_OUTPUT, EVAL_CRITERIA, CASE_TYPE, CREATED_BY)
         VALUES (:did, :input, :expected, :crit, :ctype, :cby)`,
        {
          did: datasetId,
          input: inputData,
          expected: get("expected_output") || null,
          crit: get("eval_criteria") || null,
          ctype: get("case_type") || "NORMAL",
          cby: createdBy,
        },
      );
      created++;
    }
    await writeAudit(conn, {
      targetTable: "PM_TEST_DATASET",
      targetId: datasetId,
      action: "UPDATE",
      before: null,
      after: { csv_import: { created, skipped } },
      createdBy,
    });
  }, { commit: true });

  return { created, skipped, errors };
}
