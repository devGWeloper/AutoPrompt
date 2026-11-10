import { getGateConfig, type GateConfig, type GateProjectConfig } from "@/lib/config";
import { errorText } from "@/lib/http";
import { logger } from "@/lib/logger";
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

/** Judge one MR on its head commit; approve (or dry-run) and comment as configured. */
async function processMr(
  cfg: GateConfig,
  p: GateProjectConfig,
  st: GateState,
  botId: number,
  iid: number,
): Promise<ProjectOutcome> {
  const project = p.gitlabProjectId;
  const sk = mrKey(project, iid);

  const mr = await getMr(cfg, p, iid);
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

  const approvals = await getApprovals(cfg, p, mr.iid);
  if ((approvals.approved_by ?? []).some((a) => a.user?.id === botId)) {
    logChange(st, sk, `APPROVED|${mr.sha}`, "info", "gate: already approved by bot", {
      project,
      mr: mr.iid,
      source,
      sha: mr.sha,
    });
    return { project, mr: mr.iid, decision: "APPROVED", action: "none" };
  }

  const commit = await getCommit(cfg, p, mr.sha);
  const evidence = await loadRunEvidence(p.datasetId, toLocalWallClock(commit.committed_date));
  const verdict = evaluate(evidence);

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

  if (verdict.decision === "PASS") {
    if (cfg.dryRun) {
      action = "dry-run";
    } else {
      // Pinned to the evaluated sha: a head that moved since is refused by GitLab.
      await approveMr(cfg, p, mr.iid, mr.sha);
      action = "approved";
      logger.info("gate: approved", { project, mr: mr.iid, source, sha: mr.sha, runId: verdict.runId });
    }
  }

  if (cfg.comment && (await lastNoteKey(cfg, p, mr.iid, botId)) !== key) {
    await postNote(cfg, p, mr.iid, commentBody(verdict, cfg.dryRun, key));
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

  return { project, mr: mr.iid, decision: verdict.decision, reason: verdict.reason, action };
}

/** Every open MR into the target branch, each judged on its own. */
async function processProject(
  cfg: GateConfig,
  p: GateProjectConfig,
  st: GateState,
  botId: number,
): Promise<ProjectOutcome[]> {
  const project = p.gitlabProjectId;

  const mrs = await listOpenMrs(cfg, p);
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
    return [{ project, mr: null, decision: "NO_MR", action: "none" }];
  }
  st.lastKey.delete(project);

  const outcomes: ProjectOutcome[] = [];
  for (const m of mrs) {
    try {
      outcomes.push(await processMr(cfg, p, st, botId, m.iid));
    } catch (e) {
      // One MR failing must not stop the others; the next tick retries.
      logger.error("gate: MR failed", { project, mr: m.iid, err: errorText(e) });
      outcomes.push({ project, mr: m.iid, decision: "ERROR", action: "none" });
    }
  }
  return outcomes;
}

export async function runGateTick(trigger: TickTrigger): Promise<TickResult> {
  const cfg = getGateConfig();
  if (!cfg.baseUrl || !cfg.token || cfg.projects.length === 0) {
    return { ran: false, skipped: "not configured (gitlab.baseUrl / token / projects)", outcomes: [] };
  }
  const st = state();
  if (st.running) {
    logger.warn("gate: previous tick still running — skipped", { trigger });
    return { ran: false, skipped: "busy", outcomes: [] };
  }

  st.running = true;
  st.lastStart = Date.now();
  const outcomes: ProjectOutcome[] = [];
  try {
    if (st.botId === null) {
      try {
        st.botId = (await getBotUser(cfg)).id;
      } catch (e) {
        logger.error("gate: bot lookup failed — check gate.gitlab.baseUrl / token", { err: errorText(e) });
        return { ran: false, skipped: "bot lookup failed", outcomes };
      }
    }
    for (const p of cfg.projects) {
      try {
        outcomes.push(...(await processProject(cfg, p, st, st.botId)));
      } catch (e) {
        // One project failing must not stop the others; the next tick retries.
        logger.error("gate: project failed", { project: p.gitlabProjectId, trigger, err: errorText(e) });
        outcomes.push({ project: p.gitlabProjectId, mr: null, decision: "ERROR", action: "none" });
      }
    }
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
