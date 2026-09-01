import { NextResponse } from "next/server";
import { getCallTimeoutMs } from "./config";
import { logger } from "./logger";
import { DbNotConfiguredError } from "./db";

/** Service-layer HTTP error, mirroring FastAPI's HTTPException({status, detail}). */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** The message to put in front of a user. `String(e)` prefixes the class name
 * ("ApiError: …", "Error: …"), which reads like a stack trace leaked into the UI;
 * an `ApiError` already carries the human sentence in `detail`. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && typeof e.detail === "string") return e.detail;
  if (e instanceof Error) return e.message || String(e);
  return String(e);
}

export const notFound = (detail = "not found") => new ApiError(404, detail);
export const conflict = (detail: string) => new ApiError(409, detail);
export const badRequest = (detail: string) => new ApiError(400, detail);
export const badGateway = (detail: string) => new ApiError(502, detail);

/** Convert any thrown error into a JSON `{detail}` response, preserving the
 * `ApiError`/`{detail}` contract the client (`lib/api.ts`) expects. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ detail: e.detail }, { status: e.status });
  }
  if (e instanceof DbNotConfiguredError) {
    return NextResponse.json({ detail: e.message }, { status: 503 });
  }
  logger.error("unhandled route error", { err: String(e) });
  return NextResponse.json({ detail: "internal server error" }, { status: 500 });
}

// ── Outbound calls ────────────────────────────────────────────────────────────

/** Node's `fetch` (undici) runs timers of its own that an `AbortController`
 * never sees: headers and body have their own limits. Handing `fetch` a
 * dispatcher built from the configured number lines those up with ours, so the
 * configured limit really is the limit for *waiting on an answer*. */
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");

/**
 * How long to wait for the TCP connection itself — deliberately NOT the
 * configured call timeout.
 *
 * Opening a socket to a host that is up takes milliseconds on an internal
 * network; it does not get slower because the answer will. Tying the two
 * together meant an unreachable address was indistinguishable from a slow one:
 * with the limit at 300s, undici stopped being the first to give up and the
 * kernel's own SYN retries ended the attempt at ~127s with a bare "fetch
 * failed" — two minutes spent to learn the host never answered, and no way to
 * tell it apart from an answer that was merely late.
 *
 * Kept short so a connect failure is reported as one, in seconds. The wait for
 * the *response* is untouched and still gets the full `agent.timeoutSec`.
 */
const CONNECT_TIMEOUT_MS = 10_000;

type AgentCtor = new (opts: Record<string, unknown>) => object;

let agentCtor: AgentCtor | null | undefined;
const dispatchers = new Map<number, object>();

async function getAgentCtor(): Promise<AgentCtor | null> {
  if (agentCtor !== undefined) return agentCtor;
  const g = globalThis as unknown as Record<symbol, { constructor?: unknown } | undefined>;
  // undici builds the global dispatcher on the first fetch; a data: URL forces
  // that without opening a socket. The class itself is not importable (undici
  // is bundled inside Node, not a package), so we read it off the instance.
  if (!g[GLOBAL_DISPATCHER]) {
    try {
      await fetch("data:text/plain,0");
    } catch {
      /* only the side effect matters */
    }
  }
  const ctor = g[GLOBAL_DISPATCHER]?.constructor;
  agentCtor = typeof ctor === "function" ? (ctor as AgentCtor) : null;
  if (!agentCtor) {
    logger.warn("undici dispatcher unavailable — connect timeout stays at the Node default (10s)");
  }
  return agentCtor;
}

/** One dispatcher per distinct timeout, kept for the life of the process so
 * connections are still pooled. */
async function timeoutDispatcher(timeoutMs: number): Promise<object | undefined> {
  const cached = dispatchers.get(timeoutMs);
  if (cached) return cached;
  const Ctor = await getAgentCtor();
  if (!Ctor) return undefined;
  const agent = new Ctor({
    // Reaching the host, and waiting for what it says, are different waits.
    connect: { timeout: CONNECT_TIMEOUT_MS },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  dispatchers.set(timeoutMs, agent);
  return agent;
}

/**
 * `fetch` under ONE deadline covering the whole call — DNS + connect, the wait
 * for headers, and the body — instead of the three different limits Node
 * applies by default. Defaults to `agent.timeoutSec`: the single knob for
 * every outbound call (chat endpoint, judge LLM, embeddings).
 *
 * Hitting the deadline rejects with `AbortError`; callers turn that into the
 * "응답 시간 초과" message naming the configured limit.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = getCallTimeoutMs(),
): Promise<Response> {
  const dispatcher = await timeoutDispatcher(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // Not in the DOM RequestInit type; Node reads it.
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}
