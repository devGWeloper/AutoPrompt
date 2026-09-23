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
import { SYSTEM_USER } from "@/lib/types";
import { writeAudit } from "./audit";
import {
  analyzeFolder,
  describeFolder,
  lineFromLabels,
  whyNoAxes,
  type FolderAxes,
  type PurposeCase,
} from "./purposeAxes";
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

/** JSON 값 하나를 한 줄 텍스트로. 문자열은 그대로 두고 나머지는 JSON 으로 적는다 —
 * 객체를 String() 에 넣으면 "[object Object]" 가 되어 정답지가 통째로 사라진다.
 * 정답이 중첩 객체로 들어 있는 데이터셋에서 특히 그렇고, 그런 데이터셋이야말로
 * 축으로 목적을 지을 수 있는 쪽이다. */
function asText(v: unknown): string {
  return typeof v === "string" ? v : (JSON.stringify(v) ?? "");
}

/** INPUT_CTN 에서 질문과 정답을 꺼낸다 — parseCaseInput 과 같은 규칙이고, JSON 이
 * 아니면 전체가 질문이다. */
function caseQA(c: TestCase): { question: string; truth: string } {
  let question = c.input_data;
  let truth = c.expected_output ?? "";
  try {
    const o = JSON.parse(c.input_data) as Record<string, unknown>;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      if (o.question != null) question = asText(o.question);
      if (o.ground_truth != null) truth = asText(o.ground_truth);
    }
  } catch {
    // JSON 이 아니면 INPUT_CTN 전체가 질문이다.
  }
  return { question, truth };
}

/** 케이스 하나를 데이터셋 요약용 한 줄로. 폴더 이름도 같이 — 폴더는 사람이 이미
 * 붙여 둔 분류라 목적을 가장 곧장 말해 주는 값이다. */
function purposeLine(c: TestCase, i: number): string {
  const { question, truth } = caseQA(c);
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

// ---- 데이터 한 건씩 목적 채우기 ----

/** 한 번의 요청으로 채우는 상한. 넘는 만큼은 다음 요청으로 넘긴다 — 버튼 한 번에
 * 수백 번의 LLM 호출이 나가면 안 된다. */
const CASE_PURPOSE_MAX = 200;
/**
 * 한 번의 호출에 함께 올리는 데이터 수.
 *
 * 1이면 한 건씩 묻고 한 건씩 채워진다. 답이 한꺼번에 돌아오는 이상 화면에 나타나는
 * 단위는 이 수를 넘을 수 없으므로, 채워지는 대로 보이려면 1이어야 한다.
 *
 * 한 건씩 물어도 답의 질은 떨어지지 않는다. 형제와 견주는 일은 이미 끝나 있기
 * 때문이다 — 소분류 전체를 보고 뽑은 축 목록과, 그 건의 값이 형제 몇 건과 같은지가
 * 프롬프트에 함께 실린다(pickKeyAxes). 모아서 올려야 비교가 되던 예전 방식과 다르다.
 * 산문 쪽은 애초에 그 건의 질문과 정답만 보고 쓰는 것이라 더 말할 것도 없다.
 *
 * 값은 오직 호출 수다. 마흔다섯 건이면 마흔다섯 번 부르고, `agent.caseDelaySec` 이
 * 걸려 있으면 그 사이마다 쉰다. 데이터셋이 크고 기다림이 길어 못 견디겠으면 이
 * 수를 올리면 되는데, 올린 만큼 화면은 한 번에 그만큼씩 나타난다.
 */
const CASE_PURPOSE_BATCH = 1;
/** 이미 목적이 적힌 형제 중 몇 건을 본보기로 같이 올릴지. */
const CASE_PURPOSE_HINTS = 8;
/**
 * 채우는 동안 바깥에 알리는 두 자리. 스트림 라우트가 이걸 SSE 프레임으로 바꾼다.
 *
 * 둘이 따로 있는 건 알릴 것이 두 가지라서다. `onFilled` 는 결과이고, `onProgress` 는
 * 결과가 나오기까지의 기다림이다. 한 묶음이 도는 동안은 아무 일도 안 일어난 것처럼
 * 보이는데, LLM 호출에 설정된 간격(`agent.caseDelaySec`)까지 붙으면 그 침묵이 길다.
 */
interface FillHooks {
  /** 한 덩어리가 저장될 때마다. */
  onFilled?: (items: { case_id: number; purpose: string }[]) => void;
  /** 묶음을 부르기 직전마다 — 지금까지 끝낸 수와 이번에 채울 전체 수. */
  onProgress?: (done: number, total: number) => void;
}

/** 데이터 한 건의 목적 길이 상한 — 목록에서 한 줄로 읽히는 길이. */
const CASE_PURPOSE_LEN = 60;
/** 축 미리보기가 폴더마다 보여 주는 예시 목적 수. 축이 무엇을 짚는지는 몇 줄이면
 * 드러나고, 전건을 실어 보내면 미리보기가 목록이 된다. */
/** 폴더 공통값을 프롬프트에 몇 개까지 적을지. 전제를 늘어놓는 자리라 서넛이면 족하다. */
const PREMISE_MAX = 4;
/** 축 하나를 소개할 때 보여 주는 값의 수. 갈래가 무엇인지 알면 되지 전부 늘어놓을
 * 일은 아니다. */
const AXIS_SAMPLE_VALUES = 4;
/** 프롬프트에 적는 값의 길이 상한. */
const VALUE_SHOW = 24;
/** 한 건에 대해 LLM 이 고를 수 있는 키의 수. 둘이면 족하고, 셋부터는 목적이 아니라
 * 정답지 요약이 된다. */
const PICK_MAX = 2;
const AXIS_PREVIEW_SAMPLES = 5;
/** 미리보기가 늘어놓는 열 수의 상한. 키가 수십 개인 정답지에서 미리보기가 스키마
 * 덤프가 되지 않게. */
const AXIS_PREVIEW_COLUMNS = 20;

/** 케이스를 축 분석이 아는 모양으로. 정답은 두 군데 있고 채점이 INPUT_CTN 의
 * `ground_truth` 를 먼저 보므로(parseCase), 축도 같은 것을 봐야 한다 — 화면의 정답과
 * 목적이 말하는 정답이 갈리면 안 된다. */
function toPurposeCase(c: TestCase): PurposeCase {
  const { question, truth } = caseQA(c);
  return { case_id: c.case_id, ground_truth: truth || c.expected_output, question };
}

/** 데이터 한 건을 프롬프트 한 줄로. 폴더는 이미 묶음의 머리에 적혀 있어 빼고,
 * 번호는 돌아올 답을 되짚을 열쇠다. */
function dataLine(c: TestCase, n: number): string {
  const { question, truth } = caseQA(c);
  const answer = truth ? `\n   정답: ${clip(truth, PURPOSE_FIELD)}` : "";
  return `${n}. ${clip(question, PURPOSE_FIELD)}${answer}`;
}

/** 폴더 전체가 공통으로 갖는 값. 목적에 적으면 모든 건이 같은 말을 하게 되므로
 * "이건 고르지 말라" 고 일러 주려고 뽑는다. */
function folderPremise(axes: FolderAxes): string {
  const fixed = axes.fixed.slice(0, PREMISE_MAX);
  if (fixed.length === 0) return "";
  const parts = fixed.map((c) => {
    const first = c.cells.values().next().value;
    return `${c.label}='${clip(first ? first.text : "", VALUE_SHOW)}'`;
  });
  return `이 소분류의 모든 데이터가 공통으로 갖는 값 (갈리지 않으므로 고르지 마세요): ${parts.join(", ")}\n`;
}

/** 소분류에 어떤 축이 있고 몇 갈래인지. 한 건의 값만 보여 주면 그 값이 흔한 것인지
 * 드문 것인지 알 수 없어, 축이 무엇을 가르는 축인지 먼저 펼쳐 놓는다. */
function axisMenu(axes: FolderAxes): string {
  const lines = axes.splits.map((c) => {
    const seen = [...new Set([...c.cells.values()].map((v) => v.text))].slice(0, AXIS_SAMPLE_VALUES);
    const more = c.distinct > seen.length ? " …" : "";
    return `- ${c.label} (${c.distinct}갈래: ${seen.map((v) => clip(v, VALUE_SHOW)).join(" / ")}${more})`;
  });
  return lines.join("\n");
}

/**
 * 정답지가 JSON 인 건들의 목적 — 어느 축이 핵심인지만 LLM 이 고르고, 값과 형식은
 * 코드가 붙인다.
 *
 * 축을 세는 것만으로는 '뜻이 있는 키' 를 가려낼 수 없다. `status` 가 갈리는 것과
 * `code 타입` 이 갈리는 것은 세기로는 똑같이 두 갈래지만, 목적에 적을 값어치는 전혀
 * 다르다. 변별력 순으로 줄을 세워 봐야 그건 '얼마나 드문가' 일 뿐 '무엇을 뜻하는가'
 * 가 아니다. 그 판단은 말을 아는 쪽이 해야 한다.
 *
 * 그래서 모델에게는 **고르는 일만** 시킨다. 축 이름 목록과 이 건의 값들을 주고 핵심
 * 키의 이름만 돌려받는다. 값을 옮겨 적게 하지 않으니 틀릴 수가 없고, 형식을 쓰게
 * 하지 않으니 흔들릴 수가 없다 — 모델이 자유로운 자리는 '어느 키인가' 하나뿐이다.
 *
 * 아는 이름이 하나도 안 돌아온 건은 변별력 순으로 고른 기본 줄로 메운다.
 */
async function pickKeyAxes(
  head: string,
  premise: string,
  batch: TestCase[],
  axes: FolderAxes,
): Promise<{ id: number; text: string }[]> {
  const block = batch.map((c, i) => {
    const facts = axes.facts.get(c.case_id) ?? [];
    // 값 옆에 '형제 몇 건이 같은 값인지' 를 붙인다. 이게 없으면 모델은 값만 보고
    // 고르게 되는데, 그 값이 이 건만의 것인지 다들 비슷하게 갖는 것인지를 값만으로는
    // 알 수 없다 — 변별력은 값이 아니라 분포에 있다.
    return (
      `${i + 1}. 질문: ${clip(caseQA(c).question, PURPOSE_FIELD)}\n` +
      `   값: ${facts.map((f) => `${f.text} [같은 값 ${f.same}/${f.of}건]`).join(", ")}`
    );
  });

  const user = [
    head,
    "",
    premise,
    `이 소분류의 데이터를 모두 견줘 '값이 갈리는 지점' 을 뽑았습니다:`,
    axisMenu(axes),
    "",
    `아래 ${batch.length}건입니다. 각 건이 그 지점들에서 어떤 값을 갖는지 적었습니다.`,
    `대괄호 안 [같은 값 M/N건] 은 그 키를 가진 형제 N건 가운데 이 건과 같은 값인 것이 ` +
      `M건이라는 뜻입니다.`,
    "",
    block.join("\n"),
    "",
    `각 건마다, 그 건이 무엇을 확인하려는 것인지 말해 주는 **핵심 키의 이름만** ` +
      `골라 주세요. 문장은 쓰지 마세요 — 목적 문구는 제가 만듭니다.`,
    `- **소분류의 다른 건들도 비슷한 값을 갖는 키는 중요하지 않습니다.** M이 N에 ` +
      `가까울수록 다들 같은 값이라는 뜻이라, 그 키로는 이 건이 무엇을 확인하는 건인지 ` +
      `알 수 없습니다. 이 건만 다르게 나오는 쪽을 고르세요.`,
    `- 나열된 키가 다 쓸모 있는 것은 아닙니다. 우연히 갈렸을 뿐이거나 부수적인 것` +
      `(타입·길이·유무 같은 파생값, 내부 플래그)은 빼고, 그 건의 의도를 드러내는 ` +
      `것만 남기세요.`,
    `- 1개면 충분하면 1개만. 많아야 2개입니다.`,
    `- 반드시 위에 적힌 키 이름을 글자 그대로 쓰세요. 새로 만들거나 값을 함께 쓰지 마세요.`,
    `- 모든 건에 답하고, 번호(n)는 위 번호 그대로 쓰세요.`,
    `JSON 형식: {"picks":[{"n":1,"keys":["키이름"]}]}`,
  ].filter(Boolean).join("\n");

  const r = await chatJson<{ picks?: { n?: number; keys?: unknown }[] }>(
    "당신은 LLM 평가 데이터에서 '이 건이 무엇을 확인하는 건인지' 를 말해 주는 키를 " +
      "골라 내는 사람입니다. 고른 키 이름만 JSON 으로 답하세요.",
    user,
  );

  const chosen = new Map<number, string[]>();
  for (const item of r.picks ?? []) {
    const at = Number(item?.n) - 1;
    if (!Number.isInteger(at) || at < 0 || at >= batch.length) continue;
    const keys = Array.isArray(item?.keys) ? item.keys.map((k) => String(k)) : [];
    if (keys.length) chosen.set(at, keys.slice(0, PICK_MAX));
  }

  const out: { id: number; text: string }[] = [];
  for (let i = 0; i < batch.length; i++) {
    const c = batch[i];
    const facts = axes.facts.get(c.case_id) ?? [];
    const text =
      lineFromLabels(facts, chosen.get(i) ?? [], CASE_PURPOSE_LEN) ??
      axes.purposes.get(c.case_id) ??
      "";
    if (text) out.push({ id: c.case_id, text });
  }
  return out;
}

/** 묶음 하나를 물어보고 번호를 되짚어 담는다. 답이 안 온 건은 `fallback` 이 채우고,
 * 그것도 없으면 그 건은 이번에 비는 채로 남는다 — 다시 누르면 이어서 채워진다. */
async function askPurposes(
  user: string,
  batch: TestCase[],
  fallback: (c: TestCase) => string | null,
): Promise<{ id: number; text: string }[]> {
  const r = await chatJson<{ purposes?: { n?: number; purpose?: string }[] }>(
    "당신은 LLM 평가 데이터를 보고 각 건이 무엇을 확인하려는 것인지 한 줄로 적는 " +
      "사람입니다. 반드시 JSON 으로만 답하세요.",
    user,
  );
  const byIndex = new Map<number, string>();
  for (const item of r.purposes ?? []) {
    // 번호는 이 묶음 안에서의 1-based 자리다. 엉뚱한 번호가 오면 그 항목만 버린다.
    const at = Number(item?.n) - 1;
    const text = clip(String(item?.purpose ?? ""), CASE_PURPOSE_LEN);
    if (!Number.isInteger(at) || at < 0 || at >= batch.length || !text) continue;
    byIndex.set(at, text);
  }
  const out: { id: number; text: string }[] = [];
  for (let i = 0; i < batch.length; i++) {
    const text = byIndex.get(i) ?? fallback(batch[i]);
    if (text) out.push({ id: batch[i].case_id, text });
  }
  return out;
}

/**
 * 데이터 한 건마다 "이 건으로 무엇을 확인하는가" 를 채운다.
 *
 * 한 건만 떼어 놓고 물으면 질문을 고쳐 쓴 문장이 돌아온다. 그 건이 무엇을 확인하는
 * 건지는 옆의 형제들과 견줘야 갈리기 때문이다 — "A 는 부분취소 금액, B 는 전액취소
 * 후 잔액" 처럼. 그래서 같은 폴더의 데이터를 함께 놓고 서로 다른 지점을 짚는다.
 * 폴더로 묶는 건 '같은 폴더에 넣었다' 는 것 자체가 이미 사람이 해 둔 갈래 나누기라서다.
 *
 * 목적의 형식은 `키='값', 키='값' 확인` 한 가지다. 목적은 읽는 글이 아니라 목록에서
 * 훑는 표지라, 문장으로 풀어 쓰는 것보다 같은 자리에 같은 것이 오는 쪽이 빠르게
 * 읽힌다.
 *
 * 정답지가 JSON 이면 두 손으로 짓는다.
 *
 * 먼저 소분류(폴더) 전체를 견줘 값이 갈리는 지점을 센다(purposeAxes). 같은 소분류
 * 안에서는 키가 같고 값만 다르므로, 표로 세우면 무엇이 갈리는지가 그대로 나오고
 * 주문번호나 타임스탬프는 거기서 저절로 떨어져 나간다 — 예전 프롬프트가 "A-1031
 * 주문의 취소 확인" 같은 걸 쓰던 이유가 그 열을 변별점으로 오해해서였는데, 세어 보면
 * 그럴 수가 없다.
 *
 * 그다음 그중 **어느 것이 핵심인지** 를 LLM 이 고른다. 갈린다고 다 뜻이 있는 건
 * 아니어서(우연히 갈린 내부 버전값, 배열 길이 같은 파생값) 그 판단은 말을 아는 쪽이
 * 해야 한다. 다만 고르는 일까지만 시키고 값과 형식은 코드가 붙인다 — 그래야 값을
 * 옮겨 적다 틀리거나 형식이 흔들릴 여지가 없다.
 *
 * 정답지가 산문이면 축이 없다. 그때는 그 건의 질문과 정답만 보고 LLM 이 자유롭게
 * 쓴다 — 셀 것이 없으니 형식을 강제할 근거도 없다.
 *
 * 이미 적혀 있는 목적은 **덮는다.** 이 버튼은 빈 칸 채우기가 아니라 다시 짓기다 —
 * 정답지를 고쳤거나 형제가 늘어 축이 달라졌을 때, 또는 프롬프트를 손본 뒤 전체를
 * 새로 뽑는 것이 쓰임이다. 빈 칸만 치면 두 번째 누름부터는 아무 일도 하지 않는다.
 *
 * 사람이 손으로 쓴 목적도 함께 덮인다. 되돌리기는 화면이 맡는다 — 덮기 전의 값을
 * 쥐고 있다가 그대로 돌려놓는다(DatasetsPanel).
 */
export async function fillCasePurposes(
  datasetId: number,
  caseIds?: number[] | null,
  hooks?: FillHooks,
): Promise<{ filled: number; remaining: number }> {
  const ds = await getDatasetDetail(datasetId);
  const all = await listCases(datasetId);
  const pick = Array.isArray(caseIds) && caseIds.length ? new Set(caseIds.map(Number)) : null;
  // 이미 적힌 목적도 대상이다 — 버튼은 '빈 칸 채우기' 가 아니라 '다시 짓기' 다.
  // 축이 달라졌거나(형제가 늘었거나 정답지를 고쳤거나) 프롬프트를 손본 뒤 전체를
  // 새로 뽑는 것이 이 버튼의 쓰임이라, 빈 칸만 치면 두 번째부터는 아무 일도 안 한다.
  const targets = all.filter((c) => pick === null || pick.has(c.case_id));
  if (targets.length === 0) throw badRequest("채울 데이터가 없습니다");

  const todo = targets.slice(0, CASE_PURPOSE_MAX);
  const byFolder = new Map<string, TestCase[]>();
  for (const c of todo) {
    const k = c.case_type || "NORMAL";
    const list = byFolder.get(k);
    if (list) list.push(c);
    else byFolder.set(k, [c]);
  }

  // 한 덩어리가 지어질 때마다 저장하고 알린다. 예전처럼 끝에 한 번에 쓰면 스무
   // 건짜리 LLM 묶음이 다 돌 때까지 화면에는 아무것도 없고, 도중에 끊기면 이미 지어
  // 놓은 것까지 같이 사라진다. 덩어리마다 커밋하면 둘 다 없는 문제가 된다.
  let total = 0;
  const flush = async (chunk: { id: number; text: string }[]): Promise<void> => {
    if (chunk.length === 0) return;
    await withConn(async (conn) => {
      for (const f of chunk) {
        // 적혀 있던 목적은 덮는다. DATASET_ID 를 함께 거는 건 남의 데이터셋 행을
        // 건드리지 않기 위해서다.
        await conn.execute(
          `UPDATE PTX_DATASET_DET SET CRITERIA_CTN = :crit
            WHERE CASE_ID = :cid AND DATASET_ID = :did`,
          { crit: f.text, cid: f.id, did: datasetId },
        );
      }
    }, { commit: true });
    total += chunk.length;
    hooks?.onFilled?.(chunk.map((f) => ({ case_id: f.id, purpose: f.text })));
  };

  for (const [folder, items] of byFolder) {
    // 축은 폴더 전체를 보고 센다. 목적이 이미 적힌 형제도 값의 분포에는 들어가야
    // 한다 — 무엇이 흔하고 무엇이 드문지는 채울 건들만 봐서는 알 수 없다.
    const axes = analyzeFolder(
      all.filter((c) => (c.case_type || "NORMAL") === folder).map(toPurposeCase),
      { folder, maxLen: CASE_PURPOSE_LEN },
    );
    // 구분점이 잡힌 건과 그렇지 않은 건. 앞쪽은 무엇이 다른지를 이미 아니까 그것만
    // 건네고 문장을 맡기면 되고, 뒤쪽은 예전처럼 질문과 정답을 통째로 올려야 한다.
    const grounded = items.filter((c) => (axes.facts.get(c.case_id) ?? []).length > 0);
    const blind = items.filter((c) => (axes.facts.get(c.case_id) ?? []).length === 0);

    if (!llmConfigured()) {
      // LLM 이 없으면 변별력 순으로 고른 기본 줄이라도 남긴다. 핵심 키를 가려내지
      // 못해 부수적인 축이 섞일 수 있지만, 비어 있는 것보다는 낫다.
      await flush(
        grounded
          .map((c) => ({ id: c.case_id, text: axes.purposes.get(c.case_id) ?? "" }))
          .filter((f) => f.text),
      );
      // 여기서 던지면 방금 얻은 목적까지 같이 버려진다. 다음 폴더는 계속 본다 —
      // 그 폴더는 구분점만으로 다 채워질 수도 있다.
      if (total > 0) continue;
      throw badRequest("LLM 엔드포인트가 설정되어 있지 않습니다 (config.yml llm.endpoint)");
    }

    const hints = all
      .filter((c) => (c.case_type || "NORMAL") === folder && (c.eval_criteria ?? "").trim())
      .slice(0, CASE_PURPOSE_HINTS);
    const hintBlock = hints.length
      ? `같은 폴더에서 이미 목적이 적힌 데이터 (말투와 결의 본보기):\n` +
        `${hints.map((h) => `- ${clip(caseQA(h).question, 80)} → ${h.eval_criteria}`).join("\n")}\n`
      : "";
    const head = [
      `평가 데이터셋 "${ds.dataset_nm}"${ds.description ? ` — ${ds.description}` : ""}`,
      folder === "NORMAL" ? "폴더 없음" : `폴더: ${folder}`,
    ].join("\n");

    // 정답지가 JSON 인 건: 소분류 전체를 보고 뽑은 축 가운데 어느 것이 핵심인지만
    // LLM 이 고른다. 값도 형식도 코드가 붙인다.
    for (let i = 0; i < grounded.length; i += CASE_PURPOSE_BATCH) {
      const batch = grounded.slice(i, i + CASE_PURPOSE_BATCH);
      hooks?.onProgress?.(total, todo.length);
      await flush(await pickKeyAxes(head, folderPremise(axes), batch, axes));
    }

    // 정답지가 산문인 건: 축이 없으니 그 건의 입출력만 보고 자유롭게 쓴다.
    for (let i = 0; i < blind.length; i += CASE_PURPOSE_BATCH) {
      const batch = blind.slice(i, i + CASE_PURPOSE_BATCH);
      hooks?.onProgress?.(total, todo.length);
      const user = [
        head,
        "",
        hintBlock,
        `아래 ${batch.length}건입니다.`,
        batch.map((c, n) => dataLine(c, n + 1)).join("\n"),
        "",
        `각 건이 무엇을 확인하려는 것인지 한국어 한 구절(${CASE_PURPOSE_LEN}자 이내)로 ` +
          `적으세요.`,
        `- 그 건의 질문과 정답만 보고 쓰세요.`,
        `- 질문을 그대로 옮겨 쓰지 마세요. 무엇을 보려고 이 질문을 넣었는지를 쓰세요.`,
        `- 번호(n)는 위 번호 그대로 쓰고, 모든 건에 대해 답하세요.`,
        `JSON 형식: {"purposes":[{"n":1,"purpose":"..."}]}`,
      ].filter(Boolean).join("\n");

      await flush(await askPurposes(user, batch, () => null));
    }
  }
  if (total === 0) throw badRequest("요약을 받지 못했습니다 — 다시 시도해 주세요");

  return { filled: total, remaining: targets.length - total };
}

/**
 * 고른 데이터의 목적을 지운다.
 *
 * 채우기는 한 번에 200건을 건드리는 일이라 무를 길이 있어야 한다. 토스트의 되돌리기는
 * 그 자리를 뜨면 사라지고, 채운 것이 마음에 안 드는 걸 나중에 알아차리는 일도 많다 —
 * 목록에서 골라 지우는 길이 그래서 따로 있다.
 *
 * 비어 있던 칸을 또 비우는 건 셈에 넣지 않는다. 돌아오는 수는 '실제로 지워진 것' 이라
 * 화면이 "3건을 지웠습니다" 라고 말하면 정말 세 줄이 사라진 것이다.
 */
export async function clearCasePurposes(
  datasetId: number,
  caseIds: number[] | null,
): Promise<{ cleared: number }> {
  const ids = (caseIds ?? []).map(Number).filter(Number.isInteger);
  if (ids.length === 0) throw badRequest("지울 데이터를 고르세요");

  return withConn(async (conn) => {
    let cleared = 0;
    for (const cid of ids) {
      // DATASET_ID 를 함께 걸어 남의 데이터셋 행을 건드리지 않게 하고, 이미 비어
      // 있는 행은 조건에서 걸러 셈이 부풀지 않게 한다.
      const res = await conn.execute(
        `UPDATE PTX_DATASET_DET SET CRITERIA_CTN = NULL
          WHERE CASE_ID = :cid AND DATASET_ID = :did AND CRITERIA_CTN IS NOT NULL`,
        { cid, did: datasetId },
      );
      cleared += Number(res.rowsAffected ?? 0);
    }
    return { cleared };
  }, { commit: true });
}

/**
 * 폴더별로 어떤 축이 잡히는지 보여 준다 — 아무것도 쓰지 않고, LLM 도 부르지 않는다.
 *
 * 목적을 채우는 건 되돌리기가 있어도 200건을 한꺼번에 건드리는 일이라, 어떤 기준으로
 * 지어질지 먼저 보는 길이 있어야 한다. 축은 호출 없이 계산되므로 이 미리보기가 공짜다.
 *
 * 스키마가 어긋난 건도 같이 온다. "한 카테고리 안에서 키는 같다" 는 전제를 깨는
 * 쪽이라 대개는 정답지의 오타다 — 목적을 보러 왔다가 정답지를 고치게 된다.
 */
export async function previewCaseAxes(datasetId: number): Promise<{
  folders: {
    folder: string;
    cases: number;
    parsed: number;
    summary: string;
    axes: { id: string; label: string; role: string; echo: boolean; distinct: number; present: number }[];
    /** 축이 하나도 없을 때 그 이유. 있으면 null. */
    reason: string | null;
    /** 정답지에 실제로 적힌 열 전부 — 무엇이 왜 빠졌는지 숫자로 보는 자리다. */
    columns: { label: string; role: string; distinct: number; present: number }[];
    samples: { case_id: number; purpose: string }[];
    unparsed: number[];
    outliers: { case_id: number; missing: string[]; extra: string[] }[];
  }[];
}> {
  const all = await listCases(datasetId);
  if (all.length === 0) throw badRequest("케이스가 없어 볼 축이 없습니다");

  const byFolder = new Map<string, TestCase[]>();
  for (const c of all) {
    const k = c.case_type || "NORMAL";
    const list = byFolder.get(k);
    if (list) list.push(c);
    else byFolder.set(k, [c]);
  }

  const folders = [];
  for (const [folder, items] of byFolder) {
    const f = analyzeFolder(items.map(toPurposeCase), { folder, maxLen: CASE_PURPOSE_LEN });
    folders.push({
      folder,
      cases: f.cases,
      parsed: f.parsed,
      summary: describeFolder(f),
      // 쓰이는 축만 — 모든 열을 늘어놓으면 고정값과 타입 열이 화면을 덮는다.
      axes: f.splits.map((c) => ({
        id: c.id,
        label: c.label,
        role: c.role,
        echo: c.echo,
        distinct: c.distinct,
        present: c.present,
      })),
      reason: whyNoAxes(f),
      // 원값 열만. 파생 열(부호·길이·유무)은 원값에서 나온 것이라 여기 같이 놓으면
      // 같은 키가 다섯 줄로 늘어난다.
      columns: f.columns
        .filter((c) => c.kind === "value")
        .slice(0, AXIS_PREVIEW_COLUMNS)
        .map((c) => ({ label: c.label, role: c.role, distinct: c.distinct, present: c.present })),
      samples: items
        .map((c) => ({ case_id: c.case_id, purpose: f.purposes.get(c.case_id) ?? "" }))
        .filter((s) => s.purpose)
        .slice(0, AXIS_PREVIEW_SAMPLES),
      unparsed: f.unparsed,
      outliers: f.outliers,
    });
  }
  return { folders };
}

/**
 * 케이스의 기대 정답을 주어진 값으로 갈아끼운다 — 실행 결과를 보고 "정답지 쪽이
 * 낡았다" 고 판단했을 때.
 *
 * 정답은 두 군데 있다: INPUT_CTN JSON 의 `ground_truth` 와 EXPECT_CTN. 채점은
 * 앞의 것을 먼저 보고 없으면 뒤를 쓰므로(parseCase), 한쪽만 고치면 화면에 보이는
 * 정답과 실제로 채점에 쓰이는 정답이 갈린다. 그래서 둘을 함께 쓴다.
 *
 * INPUT_CTN 의 나머지 키는 그대로 둔다 — question · contexts 는 물론, CSV 로
 * 들어온 낯선 키도 이 수정에 휩쓸려 사라지면 안 된다. 값이 JSON 이 아니면 그
 * 전체가 질문이라는 뜻이라(parseCaseInput 과 같은 규칙) EXPECT_CTN 만 고친다.
 *
 * 지난 실행 기록은 손대지 않는다. 그 실행은 그때의 정답지로 채점된 사실이고,
 * 여기서 거슬러 고치면 기록이 기록이 아니게 된다.
 */
export async function setCaseGroundTruth(
  datasetId: number,
  caseId: number,
  truth: string,
): Promise<TestCase> {
  const gt = (truth ?? "").trim();
  if (!gt) throw badRequest("정답이 비어 있습니다");
  return withConn(async (conn) => {
    const existing = await fetchCase(conn, datasetId, caseId);
    if (!existing) throw notFound("test case not found");

    let input = existing.input_data;
    try {
      const o = JSON.parse(existing.input_data) as Record<string, unknown>;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        input = JSON.stringify({ ...o, ground_truth: gt });
      }
    } catch {
      // JSON 이 아니면 전체가 질문이다 — 건드리지 않는다.
    }
    await conn.execute(
      `UPDATE PTX_DATASET_DET SET INPUT_CTN = :input, EXPECT_CTN = :expected
        WHERE CASE_ID = :cid AND DATASET_ID = :did`,
      { input, expected: gt, cid: caseId, did: datasetId },
    );
    await writeAudit(conn, {
      targetTable: "PTX_DATASET_DET",
      targetId: caseId,
      action: "UPDATE",
      before: { expected_output: existing.expected_output },
      after: { expected_output: gt },
      createdBy: SYSTEM_USER,
    });
    return (await fetchCase(conn, datasetId, caseId))!;
  }, { commit: true });
}
