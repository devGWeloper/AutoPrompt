import { readConn } from "@/lib/db";
import type { OracleConnection } from "@/lib/db";
import { badRequest, notFound } from "@/lib/http";
import { RESULT_COLS, mapRagasResult } from "@/lib/db/rows";
import { ALL_METRICS } from "@/lib/types";
import type { RagasResultRow } from "@/lib/types";
import { resolvePromptLabels } from "./ragas";

type Rows = { header: string[]; data: unknown[][] };

async function runResults(conn: OracleConnection, runId: number): Promise<RagasResultRow[]> {
  const res = await conn.execute(
    `SELECT ${RESULT_COLS} FROM PM_RAGAS_RESULT WHERE RAGAS_RUN_ID = :id ORDER BY RAGAS_RESULT_ID ASC`,
    { id: runId },
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map(mapRagasResult);
}

export async function ragasRunRows(runId: number): Promise<Rows> {
  const rows = await readConn(async (conn) => {
    const runRes = await conn.execute(`SELECT RAGAS_RUN_ID FROM PM_RAGAS_RUN WHERE RAGAS_RUN_ID = :id`, { id: runId });
    if (((runRes.rows ?? []) as unknown[]).length === 0) return null;
    const results = await runResults(conn, runId);
    const header = ["ragas_result_id", "case_id", "question", "answer", "ground_truth", ...ALL_METRICS, "error_msg"];
    const data = results.map((r) => [
      r.ragas_result_id,
      r.case_id,
      r.question,
      r.answer,
      r.ground_truth,
      ...ALL_METRICS.map((m) => r[m]),
      r.error_msg,
    ]);
    return { header, data } as Rows;
  }, null);
  if (rows === null) throw notFound("ragas run not found");
  return rows;
}

export async function ragasAbRows(abGroupId: number): Promise<Rows> {
  const rows = await readConn(async (conn) => {
    const runsRes = await conn.execute(
      `SELECT RAGAS_RUN_ID, PROMPT_ID FROM PM_RAGAS_RUN WHERE AB_GROUP_ID = :g ORDER BY RAGAS_RUN_ID ASC`,
      { g: abGroupId },
    );
    const runs = (runsRes.rows ?? []) as Record<string, unknown>[];
    if (runs.length !== 2) return "notpair" as const;
    const runA = Number(runs[0].RAGAS_RUN_ID);
    const runB = Number(runs[1].RAGAS_RUN_ID);
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
      `${labelA}_error_msg`,
      `${labelB}_error_msg`,
    ];
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
        ra ? ra.error_msg : null,
        rb ? rb.error_msg : null,
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
