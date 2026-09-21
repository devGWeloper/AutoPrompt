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
  CaseBulkResult,
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
import { chatJson, llmConfigured } from "./ragas/llmClient";

// ---- datasets ----

export async function listFlowDatasets(): Promise<Dataset[]> {
  return readConn(async (conn) => {
    // CASE_CNT rides along so the picker can show how many cases a dataset holds
    // without a request per dataset.
    const res = await conn.execute(
      `SELECT ${DATASET_COLS},
              (SELECT COUNT(*) FROM PTX_DATASET_DET d WHERE d.DATASET_ID = m.DATASET_ID) AS CASE_CNT
         FROM PTX_DATASET_MAS m
        WHERE m.ACTIVE_YN = 'Y'
        ORDER BY m.CRT_TM DESC`,
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapDataset);
  }, []);
}

async function fetchDataset(conn: OracleConnection, id: number): Promise<Dataset | null> {
  const res = await conn.execute(`SELECT ${DATASET_COLS} FROM PTX_DATASET_MAS WHERE DATASET_ID = :id`, { id });
  const rows = (res.rows ?? []) as Record<string, unknown>[];
  return rows.length ? mapDataset(rows[0]) : null;
}

async function countCases(conn: OracleConnection, id: number): Promise<number> {
  const res = await conn.execute(`SELECT COUNT(*) AS N FROM PTX_DATASET_DET WHERE DATASET_ID = :id`, { id });
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
      `INSERT INTO PTX_DATASET_MAS (DATASET_NM, DESC_CTN, ACTIVE_YN, USER_ID)
       VALUES (:nm, :descr, 'Y', :cby) RETURNING DATASET_ID INTO :out_id`,
      { nm: payload.dataset_nm, descr: payload.description ?? null, cby: createdBy },
    );
    await writeAudit(conn, {
      targetTable: "PTX_DATASET_MAS",
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
      sets.push("DESC_CTN = :descr");
      binds.descr = payload.description;
      applied.description = payload.description;
    }
    if (payload.is_active !== undefined) {
      sets.push("ACTIVE_YN = :act");
      binds.act = payload.is_active;
      applied.is_active = payload.is_active;
    }
    if (sets.length) {
      await conn.execute(`UPDATE PTX_DATASET_MAS SET ${sets.join(", ")} WHERE DATASET_ID = :id`, binds);
    }
    await writeAudit(conn, {
      targetTable: "PTX_DATASET_MAS",
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

    // The FKs carry the rules: cases cascade away with the dataset, while past
    // runs keep their rows (DATASET_ID → NULL) and still show DATASET_NM from
    // the snapshot taken when the run was created.
    await conn.execute(`DELETE FROM PTX_DATASET_MAS WHERE DATASET_ID = :id`, { id });

    await writeAudit(conn, {
      targetTable: "PTX_DATASET_MAS",
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
      `SELECT ${CASE_COLS} FROM PTX_DATASET_DET WHERE DATASET_ID = :id ORDER BY CASE_ID ASC`,
      { id: datasetId },
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map(mapCase);
  }, []);
}

async function fetchCase(conn: OracleConnection, datasetId: number, caseId: number): Promise<TestCase | null> {
  const res = await conn.execute(
    `SELECT ${CASE_COLS} FROM PTX_DATASET_DET WHERE CASE_ID = :cid AND DATASET_ID = :did`,
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
      `INSERT INTO PTX_DATASET_DET (DATASET_ID, INPUT_CTN, EXPECT_CTN, CRITERIA_CTN, TYPE_CD, USER_ID)
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

const BULK_MAX = 2000;

/**
 * Save many cases in one transaction — the import grid and "기록 → 데이터셋".
 * A folder name the dataset does not have yet is registered here rather than
 * left as a stray value: typing it into the folder column is the request.
 * All-or-nothing, so a failed save never leaves half a paste behind.
 */
export async function createCases(
  datasetId: number,
  cases: CaseCreate[] | undefined,
  createdBy: string,
): Promise<CaseBulkResult> {
  await requireDataset(datasetId);
  if (!Array.isArray(cases) || cases.length === 0) throw badRequest("저장할 케이스가 없습니다");
  if (cases.length > BULK_MAX) throw badRequest(`한 번에 ${BULK_MAX}건까지 저장할 수 있습니다`);

  const rows = cases.map((c, i) => {
    const input = typeof c?.input_data === "string" ? c.input_data.trim() : "";
    if (!input) throw badRequest(`${i + 1}번째 케이스: 질문이 비어 있습니다`);
    let type = (c.case_type ?? "").trim() || "NORMAL";
    if (type.toUpperCase() === "NORMAL") type = "NORMAL";
    if (type.length > 50) throw badRequest(`${i + 1}번째 케이스: 폴더 이름이 너무 깁니다 (최대 50자)`);
    if (type.startsWith("*")) throw badRequest(`${i + 1}번째 케이스: 폴더 이름은 '*' 로 시작할 수 없습니다`);
    return { input, expected: c.expected_output ?? null, crit: c.eval_criteria ?? null, type };
  });

  return withConn(async (conn) => {
    const known = new Set(
      (((await conn.execute(`SELECT TYPE_CD FROM PTX_CASETYPE_MAS WHERE DATASET_ID = :did`, {
        did: datasetId,
      })).rows ?? []) as Record<string, unknown>[]).map((t) => String(t.TYPE_CD)),
    );
    const foldersCreated = Array.from(new Set(rows.map((r) => r.type))).filter(
      (t) => t !== "NORMAL" && !known.has(t),
    );
    for (const cd of foldersCreated) {
      await conn.execute(
        `INSERT INTO PTX_CASETYPE_MAS (DATASET_ID, TYPE_CD, USER_ID) VALUES (:did, :cd, :actor)`,
        { did: datasetId, cd, actor: createdBy },
      );
    }
    for (const r of rows) {
      await conn.execute(
        `INSERT INTO PTX_DATASET_DET (DATASET_ID, INPUT_CTN, EXPECT_CTN, CRITERIA_CTN, TYPE_CD, USER_ID)
         VALUES (:did, :input, :expected, :crit, :ctype, :cby)`,
        { did: datasetId, input: r.input, expected: r.expected, crit: r.crit, ctype: r.type, cby: createdBy },
      );
    }
    await writeAudit(conn, {
      targetTable: "PTX_DATASET_MAS",
      targetId: datasetId,
      action: "UPDATE",
      before: null,
      after: { bulk_import: { created: rows.length, folders_created: foldersCreated } },
      createdBy,
    });
    return { created: rows.length, folders_created: foldersCreated };
  }, { commit: true });
}

function caseIdList(caseIds: number[] | undefined, emptyMsg: string): number[] {
  const ids = Array.from(new Set((Array.isArray(caseIds) ? caseIds : []).map(Number).filter(Number.isInteger)));
  if (!ids.length) throw badRequest(emptyMsg);
  return ids;
}

/** Run one statement per slice of ids, handing it the `IN (...)` bind list.
 * Oracle caps an IN list at 1000 expressions. Returns the summed row count. */
async function byIdChunks(
  ids: number[],
  run: (inList: string, binds: Record<string, unknown>) => Promise<number | undefined>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const binds: Record<string, unknown> = {};
    const names = ids.slice(i, i + 500).map((id, j) => {
      binds[`c${j}`] = id;
      return `:c${j}`;
    });
    total += (await run(names.join(", "), binds)) ?? 0;
  }
  return total;
}

/** Delete several cases of one dataset at once. Ids from another dataset are
 * ignored by the DATASET_ID condition rather than reported. */
export async function deleteCases(datasetId: number, caseIds: number[] | undefined): Promise<{ deleted: number }> {
  await requireDataset(datasetId);
  const ids = caseIdList(caseIds, "삭제할 케이스가 없습니다");
  return withConn(async (conn) => {
    // Past results keep their rows: PTX_RUN_DET.CASE_ID is ON DELETE SET NULL.
    const deleted = await byIdChunks(ids, async (inList, binds) =>
      (await conn.execute(
        `DELETE FROM PTX_DATASET_DET WHERE DATASET_ID = :did AND CASE_ID IN (${inList})`,
        { ...binds, did: datasetId },
      )).rowsAffected,
    );
    return { deleted };
  }, { commit: true });
}

/** Move several cases into one folder, or out to 폴더 없음 (NORMAL). Only a
 * registered folder is a destination — the same rule as the case editor —
 * except when undoing a move, which must be able to put cases back under a
 * value that was on them without ever being a folder. */
export async function moveCases(
  datasetId: number,
  caseIds: number[] | undefined,
  caseType: string | undefined,
  allowUnregistered = false,
): Promise<{ moved: number }> {
  await requireDataset(datasetId);
  const ids = caseIdList(caseIds, "이동할 케이스가 없습니다");
  const to = (caseType ?? "").trim() || "NORMAL";
  return withConn(async (conn) => {
    if (to !== "NORMAL" && !allowUnregistered) {
      const found = await conn.execute(
        `SELECT 1 FROM PTX_CASETYPE_MAS WHERE DATASET_ID = :did AND TYPE_CD = :cd`,
        { did: datasetId, cd: to },
      );
      if (!(found.rows ?? []).length) throw notFound(`등록되지 않은 폴더입니다: ${to}`);
    }
    const moved = await byIdChunks(ids, async (inList, binds) =>
      (await conn.execute(
        `UPDATE PTX_DATASET_DET SET TYPE_CD = :cd WHERE DATASET_ID = :did AND CASE_ID IN (${inList})`,
        { ...binds, did: datasetId, cd: to },
      )).rowsAffected,
    );
    return { moved };
  }, { commit: true });
}

export async function updateCase(datasetId: number, caseId: number, payload: CaseUpdate): Promise<TestCase> {
  return withConn(async (conn) => {
    const existing = await fetchCase(conn, datasetId, caseId);
    if (!existing) throw notFound("test case not found");
    const sets: string[] = [];
    const binds: Record<string, unknown> = { cid: caseId };
    if (payload.input_data !== undefined) {
      sets.push("INPUT_CTN = :input");
      binds.input = payload.input_data;
    }
    if (payload.expected_output !== undefined) {
      sets.push("EXPECT_CTN = :expected");
      binds.expected = payload.expected_output;
    }
    if (payload.eval_criteria !== undefined) {
      sets.push("CRITERIA_CTN = :crit");
      binds.crit = payload.eval_criteria;
    }
    if (payload.case_type !== undefined) {
      sets.push("TYPE_CD = :ctype");
      binds.ctype = payload.case_type;
    }
    if (sets.length) {
      await conn.execute(`UPDATE PTX_DATASET_DET SET ${sets.join(", ")} WHERE CASE_ID = :cid`, binds);
    }
    return (await fetchCase(conn, datasetId, caseId))!;
  }, { commit: true });
}

export async function deleteCase(datasetId: number, caseId: number): Promise<void> {
  await withConn(async (conn) => {
    const existing = await fetchCase(conn, datasetId, caseId);
    if (!existing) throw notFound("test case not found");
    // PTX_RUN_DET.CASE_ID is ON DELETE SET NULL, so past results are detached
    // rather than deleted — they keep their question/answer and Records stays intact.
    await conn.execute(`DELETE FROM PTX_DATASET_DET WHERE CASE_ID = :cid`, { cid: caseId });
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
  // A case is filed into one of the dataset's folders in the UI, but a CSV can
  // carry any value. Such a row is still imported — the file is the user's data,
  // not ours to drop — and the names it used are reported back instead.
  const unknownCats = new Set<string>();

  await withConn(async (conn) => {
    const known = new Set(
      (((await conn.execute(`SELECT TYPE_CD FROM PTX_CASETYPE_MAS WHERE DATASET_ID = :did`, {
        did: datasetId,
      })).rows ?? []) as Record<string, unknown>[])
        .map((t) => String(t.TYPE_CD)),
    );
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
      const caseType = get("case_type") || "NORMAL";
      if (caseType !== "NORMAL" && !known.has(caseType)) unknownCats.add(caseType);
      await conn.execute(
        `INSERT INTO PTX_DATASET_DET (DATASET_ID, INPUT_CTN, EXPECT_CTN, CRITERIA_CTN, TYPE_CD, USER_ID)
         VALUES (:did, :input, :expected, :crit, :ctype, :cby)`,
        {
          did: datasetId,
          input: inputData,
          expected: get("expected_output") || null,
          crit: get("eval_criteria") || null,
          ctype: caseType,
          cby: createdBy,
        },
      );
      created++;
    }
    await writeAudit(conn, {
      targetTable: "PTX_DATASET_MAS",
      targetId: datasetId,
      action: "UPDATE",
      before: null,
      after: { csv_import: { created, skipped, unknown_case_types: [...unknownCats] } },
      createdBy,
    });
  }, { commit: true });

  if (unknownCats.size) {
    errors.push(`폴더에 없는 값: ${[...unknownCats].join(", ")} — 같은 이름의 폴더를 만들면 이 케이스들이 들어갑니다`);
  }

  return { created, skipped, errors };
}

// ---- 목적 한 줄 요약 ----

/** 요약에 실어 보내는 케이스 수. 데이터셋이 무엇을 시험하는지는 앞머리 몇십 건이면
 * 드러나고, 200건을 다 보내면 프롬프트만 길어지고 답은 같아진다. */
const PURPOSE_SAMPLE = 24;
/** 케이스 한 건에서 잘라 쓰는 글자 수 — 질문·정답 각각. */
const PURPOSE_FIELD = 200;
/** 돌려주는 한 줄의 상한. DESC_CTN 이 500자라 그 안에 넉넉히 들어간다. */
const PURPOSE_MAX = 120;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 케이스 하나를 요약용 한 줄로. 질문과 정답, 그리고 폴더 이름 — 폴더는 사람이
 * 이미 붙여 둔 분류라 목적을 가장 곧장 말해 주는 값이다. */
function purposeLine(c: TestCase, i: number): string {
  let question = c.input_data;
  let truth = c.expected_output ?? "";
  try {
    const o = JSON.parse(c.input_data) as Record<string, unknown>;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      if (o.question != null) question = String(o.question);
      if (o.ground_truth != null) truth = String(o.ground_truth);
    }
  } catch {
    // JSON 이 아니면 INPUT_CTN 전체가 질문이다 — parseCaseInput 과 같은 규칙.
  }
  const folder = c.case_type && c.case_type !== "NORMAL" ? ` [${c.case_type}]` : "";
  const answer = truth ? `\n   정답: ${clip(truth, PURPOSE_FIELD)}` : "";
  return `${i + 1}.${folder} ${clip(question, PURPOSE_FIELD)}${answer}`;
}

/**
 * 이 데이터셋이 무엇을 시험하는 데이터인지 LLM 에게 한 줄로 물어본다.
 *
 * 저장하지 않고 문장만 돌려준다 — 설명은 사람이 읽고 고쳐서 저장하는 값이고,
 * 버튼 한 번이 조용히 DESC_CTN 을 덮어쓰면 손으로 써 둔 설명이 사라진다.
 * 화면은 이 문장을 설명 입력칸에 채워 넣고, 저장은 평소의 PUT 이 한다.
 */
export async function suggestDatasetPurpose(datasetId: number): Promise<{ purpose: string }> {
  if (!llmConfigured()) {
    throw badRequest("LLM 엔드포인트가 설정되어 있지 않습니다 (config.yml llm.endpoint)");
  }
  const all = await listCases(datasetId);
  if (all.length === 0) throw badRequest("케이스가 없어 요약할 내용이 없습니다");

  const sample = all.slice(0, PURPOSE_SAMPLE);
  const folders = Array.from(
    new Set(all.map((c) => c.case_type).filter((t) => t && t !== "NORMAL")),
  );
  const head = [
    `전체 ${all.length}건 중 ${sample.length}건`,
    folders.length ? `폴더: ${folders.join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  const ds = await getDatasetDetail(datasetId);
  const r = await chatJson<{ purpose?: string }>(
    "당신은 LLM 평가 데이터셋을 보고 그 데이터셋이 무엇을 시험하는지 한 줄로 적는 사람입니다. " +
      "반드시 JSON 으로만 답하세요.",
    `아래는 평가 데이터셋 "${ds.dataset_nm}" 의 케이스입니다.\n` +
      `${head}\n\n${sample.map(purposeLine).join("\n")}\n\n` +
      `이 데이터셋이 어떤 목적의 테스트인지 한국어 한 문장(${PURPOSE_MAX}자 이내)으로 적으세요. ` +
      `케이스를 나열하지 말고 공통된 시험 대상과 의도를 쓰세요. ` +
      `"이 데이터셋은" 같은 머리말 없이 바로 시작하세요. ` +
      `JSON 형식: {"purpose":"..."}`,
  );
  const purpose = clip(String(r.purpose ?? ""), PURPOSE_MAX);
  if (!purpose) throw badRequest("요약을 받지 못했습니다 — 다시 시도해 주세요");
  return { purpose };
}
