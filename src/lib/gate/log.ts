import fs from "fs";
import path from "path";
import { getGateConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Gate-only log. Every line goes to the console like the app logger AND is
 * appended to `<gate.logDir>/gate-YYYY-MM-DD.log` (KST date, one JSON object per
 * line, same shape as the app log). One file per day keeps files small and, unlike
 * app.log, a redeploy does not overwrite them.
 *
 * Writing the file must never break the gate: any failure is reported once on the
 * console and the gate carries on.
 */

type Level = "INFO" | "WARN" | "ERROR";

const g = globalThis as unknown as {
  __gateLogDirReady?: string;
  __gateLogFailed?: boolean;
  __gateLogPrunedDay?: string;
};

const FILE_RE = /^gate-(\d{4}-\d{2}-\d{2})\.log$/;

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

/** Delete gate-YYYY-MM-DD.log files older than `retainDays` (0 = keep all). Only files
 * matching that exact name are touched. Runs once per day (and once at the first write). */
function prune(dir: string, today: string, retainDays: number): void {
  if (retainDays <= 0 || g.__gateLogPrunedDay === today) return;
  g.__gateLogPrunedDay = today;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - retainDays * 86_400_000).toISOString().slice(0, 10);
  for (const name of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(name);
    if (m && m[1] < cutoff) fs.unlink(path.join(dir, name), () => {});
  }
}

function appendLine(line: string): void {
  try {
    const cfg = getGateConfig();
    const dir = path.resolve(process.cwd(), cfg.logDir);
    if (g.__gateLogDirReady !== dir) {
      fs.mkdirSync(dir, { recursive: true });
      g.__gateLogDirReady = dir;
    }
    const day = kstNow().toISOString().slice(0, 10);
    prune(dir, day, cfg.logRetainDays);
    fs.appendFile(path.join(dir, `gate-${day}.log`), line + "\n", (err) => {
      if (err) reportOnce(err);
    });
  } catch (e) {
    reportOnce(e);
  }
}

function reportOnce(e: unknown): void {
  if (g.__gateLogFailed) return;
  g.__gateLogFailed = true;
  logger.error("gate log file write failed — console only", { err: String(e) });
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: kstNow().toISOString().replace("Z", "+09:00"), level, msg, ...ctx });
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  appendLine(line);
}

export const gateLog = {
  info: (msg: string, ctx?: Record<string, unknown>) => write("INFO", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("WARN", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("ERROR", msg, ctx),
};
