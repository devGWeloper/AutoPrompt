import type { NextRequest } from "next/server";

type Level = "INFO" | "WARN" | "ERROR";

function nowKst(): string {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("Z", "+09:00");
}

function log(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    ts: nowKst(),
    level,
    msg,
    ...ctx,
  };
  const line = JSON.stringify(entry);
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => log("INFO", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("WARN", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("ERROR", msg, ctx),
};

export function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return req.ip ?? null;
}

export function reqContext(req: NextRequest): Record<string, unknown> {
  return {
    ip: getClientIp(req),
    method: req.method,
    path: req.nextUrl.pathname,
    ua: req.headers.get("user-agent") ?? null,
  };
}
