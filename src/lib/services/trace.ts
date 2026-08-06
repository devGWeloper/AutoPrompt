// Intermediate-variable capture. Some nodes are judged on a variable that never
// reaches the endpoint's response (e.g. the slot-filling node's `parsed`), so the
// agent writes it to PTX_TRACE_HIS keyed by the TRACE_ID we sent it, and the run
// scores that instead of the final answer.
//
// The presence of a row IS the signal — no per-case config and no node mapping:
// only the nodes whose agent code calls the writer produce rows, and every other
// run falls back to scoring the answer.

import type { OracleConnection } from "@/lib/db";

/** Captured variable for one call. */
export interface TraceVar {
  /** Variable name the agent recorded (e.g. "parsed"). */
  varNm: string;
  /** Its value as JSON text — what gets compared and what the UI shows. */
  ctn: string;
}

const POLL_MS = 200;
const POLL_TRIES = 15; // ≈ 3s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read the variable the agent captured for ``traceId``, or null if it recorded
 * nothing (→ the caller scores the final answer instead).
 *
 * The agent commits its row before returning, but the two writes race across
 * connections, so a missing row is retried briefly rather than trusted the first
 * time. The wait only ever happens for runs that are expected to have a row.
 */
export async function readTraceVar(
  conn: OracleConnection,
  traceId: string | null,
  wait = true,
): Promise<TraceVar | null> {
  if (!traceId) return null;
  const tries = wait ? POLL_TRIES : 1;
  for (let i = 0; i < tries; i++) {
    const res = await conn.execute(
      `SELECT VAR_NM, VAR_CTN FROM PTX_TRACE_HIS
        WHERE TRACE_ID = :t ORDER BY TRACE_SEQ_ID DESC FETCH FIRST 1 ROWS ONLY`,
      { t: traceId },
    );
    const rows = (res.rows ?? []) as Record<string, unknown>[];
    if (rows.length) {
      return { varNm: String(rows[0].VAR_NM ?? ""), ctn: String(rows[0].VAR_CTN ?? "") };
    }
    if (i < tries - 1) await sleep(POLL_MS);
  }
  return null;
}
