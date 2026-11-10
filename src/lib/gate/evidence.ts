import { withConn } from "@/lib/db";
import { hasColumn } from "@/lib/db/optionalColumn";
import type { RunEvidence } from "./policy";

const FAILED_ID_LIMIT = 10;

/**
 * Evidence for one dataset: its latest single run (AB_GROUP_ID IS NULL), whether
 * it started after the commit, and how many case rows failed. READ-ONLY.
 *
 * A case passes when it has no error and EXACT_VAL = 1, or a person marked it
 * PASS_YN = 'Y'. EXACT_VAL NULL (no truth) counts as a failure — the safe side.
 *
 * @param commitLocal head commit time as 'YYYY-MM-DD HH24:MI:SS' in server local time
 */
export async function loadRunEvidence(datasetId: number, commitLocal: string): Promise<RunEvidence | null> {
  return withConn(async (conn) => {
    const runRes = await conn.execute(
      `SELECT RUN_ID, STATUS_CD,
              CASE WHEN START_TM IS NULL THEN 0 ELSE 1 END AS HAS_START,
              CASE WHEN START_TM > TO_TIMESTAMP(:c, 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END AS AFTER_COMMIT
         FROM PTX_RUN_MAS
        WHERE DATASET_ID = :ds AND AB_GROUP_ID IS NULL
        ORDER BY NVL(START_TM, CRT_TM) DESC, RUN_ID DESC
        FETCH FIRST 1 ROWS ONLY`,
      { c: commitLocal, ds: datasetId },
    );
    const run = ((runRes.rows ?? []) as Record<string, unknown>[])[0];
    if (!run) return null;
    const runId = Number(run.RUN_ID);

    // PASS_YN arrives by migration (sql/migrate_run_det_pass.sql).
    const passed = (await hasColumn(conn, "PTX_RUN_DET", "PASS_YN"))
      ? "(EXACT_VAL = 1 OR PASS_YN = 'Y')"
      : "(EXACT_VAL = 1)";
    const detRes = await conn.execute(
      `SELECT CASE_ID,
              CASE WHEN ERROR_CTN IS NULL AND ${passed} THEN 1 ELSE 0 END AS PASSED
         FROM PTX_RUN_DET
        WHERE RUN_ID = :r
        ORDER BY RESULT_ID`,
      { r: runId },
    );
    const dets = (detRes.rows ?? []) as Record<string, unknown>[];
    const failed = dets.filter((d) => Number(d.PASSED) !== 1);
    return {
      runId,
      statusCd: String(run.STATUS_CD ?? ""),
      hasStart: Number(run.HAS_START) === 1,
      afterCommit: Number(run.AFTER_COMMIT) === 1,
      total: dets.length,
      failedCount: failed.length,
      failedCaseIds: failed
        .slice(0, FAILED_ID_LIMIT)
        .map((d) => Number(d.CASE_ID))
        .filter((n) => Number.isFinite(n)),
    };
  });
}
