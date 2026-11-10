import { getGateConfig } from "@/lib/config";
import { errorText } from "@/lib/http";
import { logger } from "@/lib/logger";
import { runGateTick } from "./tick";

const g = globalThis as unknown as { __gateTimer?: ReturnType<typeof setInterval> };

/**
 * Start the periodic gate tick. Called once from `src/instrumentation.ts`.
 * Does nothing unless `gate.enabled: true` — so a dev box or a second server
 * never double-approves. The first tick runs after one interval, not at boot.
 */
export function startGateScheduler(): void {
  const cfg = getGateConfig();
  if (!cfg.enabled) {
    logger.info("gate disabled (gate.enabled is not true) — scheduler not started");
    return;
  }
  if (g.__gateTimer) return; // dev HMR / double register

  if (!cfg.baseUrl || !cfg.token || cfg.projects.length === 0) {
    logger.error("gate enabled but not configured — scheduler not started", {
      baseUrlSet: cfg.baseUrl !== "",
      tokenSet: cfg.token !== "",
      projects: cfg.projects.length,
    });
    return;
  }

  g.__gateTimer = setInterval(() => {
    runGateTick("timer").catch((e) => logger.error("gate: tick crashed", { err: errorText(e) }));
  }, cfg.intervalMs);
  g.__gateTimer.unref?.();

  logger.info("gate scheduler started", {
    intervalSec: cfg.intervalMs / 1000,
    dryRun: cfg.dryRun,
    comment: cfg.comment,
    projects: cfg.projects.map((p) => ({
      project: p.gitlabProjectId,
      source: p.sourceBranch || "(any)",
      target: p.targetBranch,
      datasetId: p.datasetId,
    })),
  });
}
