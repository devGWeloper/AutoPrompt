import { readConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, notFound } from "@/lib/http";
import { RESULT_COLS, mapRagasResult } from "@/lib/db/rows";
import { ALL_METRICS } from "@/lib/types";
import { formatModelSnapshot } from "@/lib/modelSnapshot";
import type { RagasResultRow } from "@/lib/types";
import { resolvePromptLabels } from "./ragas";

type Rows = { header: string[]; data: unknown[][] };

async function runResults(conn: OracleConnection, runId: number): Promise<RagasResultRow[]> {
  const res = await conn.execute(
    `SELECT ${RESULT_COLS} FROM PTX_RUN_DET WHERE RUN_ID = :id ORDER BY RESULT_ID ASC`,
    { id: runId },
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapRagasResult);
}

export async function ragasRunRows(runId: number): Promise<Rows> {
  const rows = await readConn(async (conn) => {
    const runRes = await conn.execute(`SELECT RUN_ID, MODEL_CTN FROM PTX_RUN_MAS WHERE RUN_ID = :id`, { id: runId });
    const runRows = (runRes.rows ?? []) as Record<string, unknown>[];
    if (runRows.length === 0) return null;
    // Repeated on every row, which is the price of a flat CSV — but two exported
    // files compared side by side are unreadable without knowing which model
    // produced which.
    const models = formatModelSnapshot(runRows[0].MODEL_CTN as string | null);
    const results = await runResults(conn, runId);
    const header = ["ragas_result_id", "case_id", "question", "answer", "ground_truth", ...ALL_METRICS, "elapsed_ms", "error_msg", "models"];
    const data = results.map((r) => [
      r.ragas_result_id,
      r.case_id,
      r.question,
      r.answer,
      r.ground_truth,
      ...ALL_METRICS.map((m) => r[m]),
      r.elapsed_ms,
      r.error_msg,
      models,
    ]);
    return { header, data } as Rows;
  }, null);
  if (rows === null) throw notFound("ragas run not found");
  return rows;
}

export async function ragasAbRows(abGroupId: number): Promise<Rows> {
  const rows = await readConn(async (conn) => {
    const runsRes = await conn.execute(
      `SELECT RUN_ID, PROMPT_ID, MODEL_CTN FROM PTX_RUN_MAS WHERE AB_GROUP_ID = :g ORDER BY RUN_ID ASC`,
      { g: abGroupId },
    );
    const runs = (runsRes.rows ?? []) as Record<string, unknown>[];
    if (runs.length !== 2) return "notpair" as const;
    const runA = Number(runs[0].RUN_ID);
    const runB = Number(runs[1].RUN_ID);
    const pidA = runs[0].PROMPT_ID != null ? Number(runs[0].PROMPT_ID) : null;
    const pidB = runs[1].PROMPT_ID != null ? Number(runs[1].PROMPT_ID) : null;

    const labels = await resolvePromptLabels(conn, [pidA, pidB]);
    const labelA = pidA && labels.get(pidA) ? `A_v${labels.get(pidA)!.version_no}` : "A";
    const labelB = pidB && labels.get(pidB) ? `B_v${labels.get(pidB)!.version_no}` : "B";

    const aResults = await runResults(conn, runA);
    const bResults = await runResults(conn, runB);
    const aBy = new Map<number | null, RagasResultRow>(aResults.map((r) => [r.case_id, r]));
    const bBy = new Map<number | null, RagasResultRow>(bResults.map((r) => [r.case_id, r]));

    const caseIds: (number | null)[] = [];
    const seen = new Set<number | null>();
    for (const cid of [...aResults.map((r) => r.case_id), ...bResults.map((r) => r.case_id)]) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      caseIds.push(cid);
    }

    const header = [
      "case_id",
      "question",
      "ground_truth",
      `${labelA}_answer`,
      `${labelB}_answer`,
      ...ALL_METRICS.flatMap((m) => [`${labelA}_${m}`, `${labelB}_${m}`]),
      `${labelA}_elapsed_ms`,
      `${labelB}_elapsed_ms`,
      `${labelA}_error_msg`,
      `${labelB}_error_msg`,
      `${labelA}_models`,
      `${labelB}_models`,
    ];
    // Per side: B may have run a model override that A did not.
    const modelsA = formatModelSnapshot(runs[0].MODEL_CTN as string | null);
    const modelsB = formatModelSnapshot(runs[1].MODEL_CTN as string | null);
    const data = caseIds.map((cid) => {
      const ra = aBy.get(cid);
      const rb = bBy.get(cid);
      return [
        cid,
        (ra && ra.question) || (rb && rb.question) || null,
        (ra && ra.ground_truth) || (rb && rb.ground_truth) || null,
        ra ? ra.answer : null,
        rb ? rb.answer : null,
        ...ALL_METRICS.flatMap((m) => [ra ? ra[m] : null, rb ? rb[m] : null]),
        ra ? ra.elapsed_ms : null,
        rb ? rb.elapsed_ms : null,
        ra ? ra.error_msg : null,
        rb ? rb.error_msg : null,
        modelsA,
        modelsB,
      ];
    });
    return { header, data } as Rows;
  }, null);
  if (rows === null || rows === "notpair") throw notFound("ab pair not found");
  return rows;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Rows): string {
  const lines = [rows.header.map(csvCell).join(",")];
  for (const row of rows.data) lines.push(row.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n"); // BOM so Excel reads UTF-8
}

export const CSV_MEDIA = "text/csv; charset=utf-8";

/** Serialize export rows. Only CSV is supported in the single-app build (xlsx
 * needed a Python-only library and is intentionally dropped — export CSV then
 * open in Excel). */
export function serialize(rows: Rows, fmt: string): { body: string; media: string; ext: string } {
  if (fmt === "csv") return { body: toCsv(rows), media: CSV_MEDIA, ext: "csv" };
  throw badRequest("only 'csv' export is supported in this build");
}
