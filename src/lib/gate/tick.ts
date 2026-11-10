import { getGateConfig, type GateConfig, type GateProjectConfig } from "@/lib/config";
import { errorText } from "@/lib/http";
import { gateLog as logger } from "./log";
import { loadRunEvidence } from "./evidence";
import {
  approveMr,
  getApprovals,
  getBotUser,
  getCommit,
  getMr,
  listNotes,
  listOpenMrs,
  OPEN_MR_PAGE,
  postNote,
} from "./gitlabClient";
import { evaluate, type Verdict } from "./policy";
import { toLocalWallClock } from "./time";

/**
 * One gate pass over every configured project (docs/gate-design.md §6).
 * Every open MR into the project's target branch is judged on its own head
 * commit, whatever branch it came from.
 *
 * State lives on `globalThis`, not in module variables: Next bundles the
 * instrumentation hook and each route handler separately, so a module-level
 * flag would not be shared between the timer and the webhook/manual routes.
 */

export type TickTrigger = "timer" | "webhook" | "manual";

export interface ProjectOutcome {
  project: string;
  mr: number | null;
  /** PASS / FAIL / WAIT / SKIP / ERROR / NO_MR / APPROVED */
  decision: string;
  reason?: string;
  /** What the gate did to the MR. */
  action: "approved" | "dry-run" | "commented" | "none";
}

export interface TickResult {
  ran: boolean;
  /** Why it did not run (not configured / busy / bot lookup failed). */
  skipped?: string;
  /** One entry per MR handled (a project with no open MR gets one NO_MR entry). */
  outcomes: ProjectOutcome[];
}

interface GateState {
  running: boolean;
  lastStart: number;
  botId: number | null;
  /** Last logged state per project / MR — so an unchanged state is not re-logged every tick. */
  lastKey: Map<string, string>;
}

const g = globalThis as unknown as { __gateState?: GateState };

function state(): GateState {
  if (!g.__gateState) g.__gateState = { running: false, lastStart: 0, botId: null, lastKey: new Map() };
  return g.__gateState;
}

const DEBOUNCE_MS = 10_000;
const MARKER_RE = /<!-- gate:(.*?) -->/;

/** State key of one MR within a project. */
const mrKey = (project: string, iid: number) => `${project}#${iid}`;

function logChange(
  st: GateState,
  stateKey: string,
  key: string,
  level: "info" | "warn",
  msg: string,
  ctx: Record<string, unknown>,
): void {
  if (st.lastKey.get(stateKey) === key) return;
  st.lastKey.set(stateKey, key);
  logger[level](msg, ctx);
}

/** The state key stored in the bot's newest [MR Gate] comment, if any. */
async function lastNoteKey(cfg: GateConfig, p: GateProjectConfig, iid: number, botId: number): Promise<string | null> {
  const notes = await listNotes(cfg, p, iid);
  for (const n of notes) {
    if (n.author?.id !== botId || !n.body.includes("[MR Gate]")) continue;
    return MARKER_RE.exec(n.body)?.[1] ?? null;
  }
  return null;
}

function commentBody(v: Verdict, dryRun: boolean, key: string): string {
  const head =
    v.decision === "PASS" ? (dryRun ? `승인 가능 (dry-run) — ${v.text}` : `승인 — ${v.text}`) : v.text;
  return `[MR Gate] ${head}\n\n<!-- gate:${key} -->`;
}

/**
 * Progress trace of one tick. Every step logs when it finishes (or fails), tagged with
 * the tick's `run` id, so one run can be followed line by line in the gate log: which
 * steps completed, and which one it stopped at.
 */
interface Trace {
  run: string;
  project?: string;
  mr?: number;
  /** Keys of the steps that finished, in order. */
  done: string[];
}

/** A step failed; `step` names which one. */
class StepError extends Error {
  readonly step: string;
  constructor(step: string, cause: unknown) {
    super(cause instanceof StepError ? cause.message : errorText(cause));
    this.step = step;
  }
}

async function step<T>(
  t: Trace,
  key: string,
  label: string,
  fn: () => Promise<T> | T,
  detail?: (r: T) => Record<string, unknown>,
): Promise<T> {
  const t0 = Date.now();
  const base = { run: t.run, project: t.project, mr: t.mr, step: key, label };
  try {
    const r = await fn();
    t.done.push(key);
    logger.info("gate: step done", { ...base, ms: Date.now() - t0, ...(detail ? detail(r) : {}) });
    return r;
  } catch (e) {
    logger.error("gate: step failed", {
      ...base,
      ms: Date.now() - t0,
      err: e instanceof StepError ? e.message : errorText(e),
    });
    throw new StepError(key, e);
  }
}

/** A step that was deliberately not run, and why. */
function skipped(t: Trace, key: string, label: string, reason: string): void {
  logger.info("gate: step skipped", { run: t.run, project: t.project, mr: t.mr, step: key, label, reason });
}

/** Judge one MR on its head commit; approve (or dry-run) and comment as configured. */
async function processMr(
  cfg: GateConfig,
  p: GateProjectConfig,
  st: GateState,
  botId: number,
  iid: number,
  t: Trace,
): Promise<ProjectOutcome> {
  const project = p.gitlabProjectId;
  const sk = mrKey(project, iid);

  const mr = await step(t, "get_mr", "MR 상태 확인", () => getMr(cfg, p, iid), (r) => ({
    sha: r.sha,
    source: r.source_branch,
    draft: !!(r.draft || r.work_in_progress),
    conflicts: !!r.has_conflicts,
  }));
  const source = mr.source_branch;

  if (mr.draft || mr.work_in_progress || mr.has_conflicts) {
    const reason = mr.has_conflicts ? "CONFLICTS" : "DRAFT";
    logChange(st, sk, `SKIP|${mr.sha}|${reason}`, "warn", "gate: MR skipped", {
      project,
      mr: mr.iid,
      source,
      sha: mr.sha,
      reason,
    });
    return { project, mr: mr.iid, decision: "SKIP", reason, action: "none" };
  }

  const approvals = await step(t, "get_approvals", "승인 여부 확인", () => getApprovals(cfg, p, mr.iid), (r) => ({
    approvedByBot: (r.approved_by ?? []).some((a) => a.user?.id === botId),
  }));
  if ((approvals.approved_by ?? []).some((a) => a.user?.id === botId)) {
    logChange(st, sk, `APPROVED|${mr.sha}`, "info", "gate: already approved by bot", {
      project,
      mr: mr.iid,
      source,
      sha: mr.sha,
    });
    return { project, mr: mr.iid, decision: "APPROVED", action: "none" };
  }

  const commit = await step(t, "get_commit", "최신 커밋 시각 조회", () => getCommit(cfg, p, mr.sha), (r) => ({
    sha: mr.sha,
    committedDate: r.committed_date,
  }));
  const evidence = await step(
    t,
    "load_evidence",
    "테스트 결과 조회",
    () => loadRunEvidence(p.datasetId, toLocalWallClock(commit.committed_date)),
    (r) => ({
      datasetId: p.datasetId || "(all)",
      runId: r?.runId ?? null,
      runStatus: r?.statusCd ?? null,
      afterCommit: r?.afterCommit ?? null,
      cases: r?.total ?? 0,
      failedCases: r?.failedCount ?? 0,
    }),
  );
  const verdict = await step(t, "evaluate", "판정", () => evaluate(evidence), (r) => ({
    decision: r.decision,
    reason: r.reason,
    runId: r.runId,
  }));

  const mode = verdict.decision === "PASS" ? (cfg.dryRun ? "DRY" : "LIVE") : "-";
  const key = [mr.sha, verdict.decision, verdict.reason, verdict.runId ?? "-", mode].join("|");
  logChange(st, sk, `VERDICT|${key}`, "info", "gate: verdict", {
    project,
    mr: mr.iid,
    source,
    sha: mr.sha,
    decision: verdict.decision,
    reason: verdict.reason,
    runId: verdict.runId,
    detail: verdict.text,
    dryRun: cfg.dryRun,
    ...(evidence && evidence.failedCaseIds.length ? { failedCaseIds: evidence.failedCaseIds } : {}),
  });

  let action: ProjectOutcome["action"] = "none";

  if (verdict.decision !== "PASS") {
    skipped(t, "approve", "승인 요청", `판정이 ${verdict.decision} 이라 승인하지 않음`);
  } else if (cfg.dryRun) {
    skipped(t, "approve", "승인 요청", "dry-run 이라 승인하지 않음");
    action = "dry-run";
  } else {
    // Pinned to the evaluated sha: a head that moved since is refused by GitLab.
    await step(t, "approve", "승인 요청", () => approveMr(cfg, p, mr.iid, mr.sha), () => ({ sha: mr.sha }));
    action = "approved";
    logger.info("gate: approved", { project, mr: mr.iid, source, sha: mr.sha, runId: verdict.runId });
  }

  if (!cfg.comment) {
    skipped(t, "post_comment", "코멘트 게시", "gate.comment=false 라 코멘트하지 않음");
  } else {
    const same = await step(
      t,
      "check_comment",
      "코멘트 중복 확인",
      async () => (await lastNoteKey(cfg, p, mr.iid, botId)) === key,
      (r) => ({ duplicate: r }),
    );
    if (same) {
      skipped(t, "post_comment", "코멘트 게시", "직전 코멘트와 결과가 같아 다시 달지 않음");
    } else {
      await step(t, "post_comment", "코멘트 게시", () =>
        postNote(cfg, p, mr.iid, commentBody(verdict, cfg.dryRun, key)),
      );
      if (action === "none") action = "commented";
      logger.info("gate: comment posted", {
        project,
        mr: mr.iid,
        source,
        sha: mr.sha,
        decision: verdict.decision,
        reason: verdict.reason,
      });
    }
  }

  return { project, mr: mr.iid, decision: verdict.decision, reason: verdict.reason, action };
}

/** Every open MR into the target branch, each judged on its own. */
async function processProject(
  cfg: GateConfig,
  p: GateProjectConfig,
  st: GateState,
  botId: number,
  run: string,
): Promise<ProjectOutcome[]> {
  const project = p.gitlabProjectId;

  const pt: Trace = { run, project, done: [] };
  const mrs = await step(pt, "list_mrs", "열린 MR 목록 조회", () => listOpenMrs(cfg, p), (r) => ({
    count: r.length,
    target: p.targetBranch,
  }));
  if (mrs.length >= OPEN_MR_PAGE) {
    logger.warn("gate: open MR list hit the page limit — older MRs are not handled", {
      project,
      limit: OPEN_MR_PAGE,
    });
  }

  // Forget the remembered state of MRs that are no longer open.
  const open = new Set(mrs.map((m) => mrKey(project, m.iid)));
  for (const k of Array.from(st.lastKey.keys())) {
    if (k.startsWith(`${project}#`) && !open.has(k)) st.lastKey.delete(k);
  }

  if (mrs.length === 0) {
    logChange(st, project, "NO_MR", "info", "gate: no open MR", {
      project,
      target: p.targetBranch,
      ...(p.sourceBranch ? { source: p.sourceBranch } : {}),
    });
    logger.info("gate: project done", { run, project, result: "NO_MR", steps: pt.done });
    return [{ project, mr: null, decision: "NO_MR", action: "none" }];
  }
  st.lastKey.delete(project);

  const outcomes: ProjectOutcome[] = [];
  for (const m of mrs) {
    const t: Trace = { run, project, mr: m.iid, done: [] };
    const t0 = Date.now();
    try {
      const o = await processMr(cfg, p, st, botId, m.iid, t);
      outcomes.push(o);
      // The MR's whole pass in one line: how far it went and how it ended.
      logger.info("gate: MR done", {
        run,
        project,
        mr: m.iid,
        decision: o.decision,
        reason: o.reason,
        action: o.action,
        steps: t.done,
        ms: Date.now() - t0,
      });
    } catch (e) {
      // One MR failing must not stop the others; the next tick retries.
      const failedStep = e instanceof StepError ? e.step : "unknown";
      logger.error("gate: MR failed", {
        run,
        project,
        mr: m.iid,
        failedStep,
        completedSteps: t.done,
        err: errorText(e),
      });
      outcomes.push({ project, mr: m.iid, decision: "ERROR", reason: failedStep, action: "none" });
    }
  }
  return outcomes;
}

export async function runGateTick(trigger: TickTrigger): Promise<TickResult> {
  const cfg = getGateConfig();
  if (!cfg.baseUrl || !cfg.token || cfg.projects.length === 0) {
    logger.warn("gate: tick skipped — not configured", {
      trigger,
      baseUrlSet: cfg.baseUrl !== "",
      tokenSet: cfg.token !== "",
      projects: cfg.projects.length,
    });
    return { ran: false, skipped: "not configured (gitlab.baseUrl / token / projects)", outcomes: [] };
  }
  const st = state();
  if (st.running) {
    logger.warn("gate: previous tick still running — skipped", { trigger });
    return { ran: false, skipped: "busy", outcomes: [] };
  }

  st.running = true;
  st.lastStart = Date.now();
  const run = st.lastStart.toString(36);
  const outcomes: ProjectOutcome[] = [];
  try {
    logger.info("gate: tick start", { run, trigger, projects: cfg.projects.length });
    if (st.botId === null) {
      try {
        st.botId = (
          await step({ run, done: [] }, "get_bot", "봇 계정 확인", () => getBotUser(cfg), (r) => ({ botId: r.id }))
        ).id;
      } catch (e) {
        logger.error("gate: bot lookup failed — check gate.gitlab.baseUrl / token", { run, err: errorText(e) });
        logger.info("gate: tick done", {
          run,
          trigger,
          result: "bot lookup failed",
          durationMs: Date.now() - st.lastStart,
        });
        return { ran: false, skipped: "bot lookup failed", outcomes };
      }
    }
    for (const p of cfg.projects) {
      try {
        outcomes.push(...(await processProject(cfg, p, st, st.botId, run)));
      } catch (e) {
        // One project failing must not stop the others; the next tick retries.
        logger.error("gate: project failed", {
          run,
          project: p.gitlabProjectId,
          trigger,
          failedStep: e instanceof StepError ? e.step : "unknown",
          err: errorText(e),
        });
        outcomes.push({ project: p.gitlabProjectId, mr: null, decision: "ERROR", action: "none" });
      }
    }
    // One line per tick, every tick — shows the batch is alive even when nothing changed.
    const byDecision: Record<string, number> = {};
    for (const o of outcomes) byDecision[o.decision] = (byDecision[o.decision] ?? 0) + 1;
    logger.info("gate: tick done", {
      run,
      trigger,
      durationMs: Date.now() - st.lastStart,
      projects: cfg.projects.length,
      mrs: outcomes.filter((o) => o.mr !== null).length,
      decisions: byDecision,
      actions: outcomes.filter((o) => o.action !== "none").map((o) => ({ mr: o.mr, action: o.action })),
    });
    return { ran: true, outcomes };
  } finally {
    st.running = false;
  }
}

/**
 * Fire-and-forget run for the webhook. Skips when a tick is running or one
 * started in the last few seconds (GitLab can send several events per MR).
 */
export function triggerGate(trigger: TickTrigger): boolean {
  const st = state();
  if (st.running || Date.now() - st.lastStart < DEBOUNCE_MS) return false;
  void runGateTick(trigger).catch((e) => logger.error("gate: triggered run failed", { trigger, err: errorText(e) }));
  return true;
}
