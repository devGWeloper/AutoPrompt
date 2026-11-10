/**
 * MR gate policy — pure, no DB / HTTP. Given the evidence about the dataset's
 * latest single run, decide PASS / FAIL / WAIT (docs/gate-design.md §7.2).
 */

export type Decision = "PASS" | "FAIL" | "WAIT";

export type ReasonCd =
  | "NO_RUN"
  | "STALE_RUN"
  | "RUN_IN_PROGRESS"
  | "RUN_NOT_DONE"
  | "EMPTY_RUN"
  | "CASE_FAILED"
  | "ALL_PASSED";

/** What the DB says about the dataset's latest single run. */
export interface RunEvidence {
  runId: number;
  statusCd: string;
  /** START_TM is set (a queued run has none yet). */
  hasStart: boolean;
  /** START_TM is strictly after the head commit's time. */
  afterCommit: boolean;
  /** Case rows of the run. */
  total: number;
  /** Case rows that did not pass (EXACT_VAL≠1 and not PASS_YN='Y', or errored). */
  failedCount: number;
  /** First few failed CASE_IDs (for the comment/log). */
  failedCaseIds: number[];
}

export interface Verdict {
  decision: Decision;
  reason: ReasonCd;
  /** Human-readable, Korean. Used as the MR comment body and the log line. */
  text: string;
  runId: number | null;
}

const IN_PROGRESS = new Set(["PENDING", "RUNNING", "CANCELLING"]);

export function evaluate(ev: RunEvidence | null): Verdict {
  if (!ev) {
    return { decision: "FAIL", reason: "NO_RUN", text: "불통과 — 해당 데이터셋의 테스트 이력이 없습니다", runId: null };
  }
  const { runId } = ev;
  const inProgress = IN_PROGRESS.has(ev.statusCd);

  if (!ev.afterCommit) {
    // A queued run has no START_TM yet; it is on its way, not stale.
    if (!ev.hasStart && inProgress) {
      return { decision: "WAIT", reason: "RUN_IN_PROGRESS", text: `대기 — run #${runId} 시작 전`, runId };
    }
    return {
      decision: "FAIL",
      reason: "STALE_RUN",
      text: `불통과 — 최신 커밋 이후 시작된 테스트가 없습니다 (최근 run #${runId})`,
      runId,
    };
  }
  if (inProgress) {
    return { decision: "WAIT", reason: "RUN_IN_PROGRESS", text: `대기 — run #${runId} 진행 중`, runId };
  }
  if (ev.statusCd !== "DONE") {
    return {
      decision: "FAIL",
      reason: "RUN_NOT_DONE",
      text: `불통과 — run #${runId} 상태 ${ev.statusCd}`,
      runId,
    };
  }
  if (ev.total === 0) {
    return { decision: "FAIL", reason: "EMPTY_RUN", text: `불통과 — run #${runId} 에 케이스 결과가 없습니다`, runId };
  }
  if (ev.failedCount > 0) {
    const more = ev.failedCount > ev.failedCaseIds.length ? " …" : "";
    const ids = ev.failedCaseIds.length ? ` (case ${ev.failedCaseIds.join(", ")}${more})` : "";
    return {
      decision: "FAIL",
      reason: "CASE_FAILED",
      text: `불통과 — run #${runId} 실패 ${ev.failedCount}건${ids}`,
      runId,
    };
  }
  return {
    decision: "PASS",
    reason: "ALL_PASSED",
    text: `run #${runId} 전체 통과 (${ev.total}/${ev.total})`,
    runId,
  };
}
