import type { OracleConnection } from "@/lib/db";
import { withConn } from "@/lib/db";
import { logger } from "@/lib/logger";

// PTX_CALL_MAS is the mirror image of PTX_TRACE_HIS: there the agent writes and
// PTX reads, here PTX writes and the agent reads. Both are keyed by the TRACE_ID
// PTX already sends in `session_system_prompt`, so neither adds a request field.
//
// One row per call that should run under a pinned model. No row = no pinning, so
// the agent uses its own config — which is what production traffic (no TRACE_ID
// at all) and side B of a comparison both get.

/** Stage this call's model config. Must be committed before the request goes
 * out, or the agent's SELECT will miss it. */
export async function writeCallConfig(
  conn: OracleConnection,
  traceId: string,
  runId: number | null,
  models: string | null,
): Promise<void> {
  if (!traceId || !models) return;
  await conn.execute(
    `INSERT INTO PTX_CALL_MAS (TRACE_ID, RUN_ID, MODEL_CTN) VALUES (:t, :rid, :m)`,
    { t: traceId, rid: runId, m: models },
  );
  await conn.commit();
}

/** Same, on its own connection, for callers with none open. Never throws: a
 * failure here means the call runs on the agent's config, which is worth a log
 * and not worth aborting a test for. */
export async function stageCallConfig(
  traceId: string,
  runId: number | null,
  models: string | null,
): Promise<void> {
  if (!traceId || !models) return;
  try {
    await withConn(async (conn) => writeCallConfig(conn, traceId, runId, models), { commit: true });
  } catch (e) {
    logger.error("call config staging failed — the call runs on agent config", {
      traceId,
      err: String(e),
    });
  }
}

/** Drop the staged rows for a run (called when its record is deleted). */
export async function deleteCallConfigs(conn: OracleConnection, runId: number): Promise<void> {
  await conn.execute(`DELETE FROM PTX_CALL_MAS WHERE RUN_ID = :id`, { id: runId });
}
