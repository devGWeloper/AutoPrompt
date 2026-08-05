import {
  getAgentConfig,
  getFlowAuthKey,
  getFlowBaseUrl,
  getFlowProtocol,
  type AgentProtocol,
} from "@/lib/config";
import { badGateway } from "@/lib/http";
import { logger } from "@/lib/logger";

// Session context sent as ``session_system_prompt`` (a STRING that is a stringified
// JSON object — the agent json.loads it to read CUBE_CHANNEL_ID & co). Channel and
// user name are fixed for this tool; the user id is whoever is calling (config
// agent.userId / the request's user_id) and TRACE_ID is issued per call.
const CUBE_CHANNEL_ID = "11111111";
const CUBE_CHANNEL_NM = "프롬프트 자동화 테스트";
const CUBE_USER_NM = "이억수";

let traceDay = "";
let traceSeq = 0;

/** ``PM-YYYYMMDD-NNNN`` — the sequence restarts at 1 on each new day (and on
 * server restart, since the counter lives in-process). */
function nextTraceId(): string {
  const d = new Date();
  const day =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}`;
  if (day !== traceDay) {
    traceDay = day;
    traceSeq = 0;
  }
  traceSeq += 1;
  return `PM-${day}-${String(traceSeq).padStart(4, "0")}`;
}

function sessionContext(userId: string, traceId: string): Record<string, string> {
  return {
    CUBE_CHANNEL_ID,
    CUBE_CHANNEL_NM,
    CUBE_USER_ID: userId,
    CUBE_USER_NM,
    TRACE_ID: traceId,
  };
}

export interface AgentAnswer {
  response: string;
  docs: string[];
  raw?: Record<string, unknown> | unknown[] | string;
}

/** A/B side of a run — each side may have its own configured endpoint. */
export type FlowSide = "a" | "b";

export function externalEnabled(): boolean {
  const a = getAgentConfig();
  return a.runMode === "external" && (a.baseUrl || a.baseUrlA || a.baseUrlB).length > 0;
}

function normalizeDocs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const d of raw) {
    if (typeof d === "string") out.push(d);
    else if (d && typeof d === "object") {
      for (const k of ["content", "text", "body"]) {
        const v = (d as Record<string, unknown>)[k];
        if (typeof v === "string" && v) {
          out.push(v);
          break;
        }
      }
    }
  }
  return out;
}

function collectTxt(obj: unknown, out: string[]): void {
  if (Array.isArray(obj)) {
    for (const item of obj) collectTxt(item, out);
  } else if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (o.type === "txt" && typeof o.value === "string") out.push(o.value);
  }
}

/** Walk an A2A result for `{kind|type: "text", text}` parts (message / artifacts). */
function collectParts(obj: unknown, out: string[]): void {
  if (Array.isArray(obj)) {
    for (const item of obj) collectParts(item, out);
    return;
  }
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  if (typeof o.text === "string" && (o.kind === "text" || o.type === "text")) {
    out.push(o.text);
    return;
  }
  for (const v of Object.values(o)) collectParts(v, out);
}

/** Aggregate a text/event-stream reply into {response, docs, raw}. */
function parseSse(text: string): AgentAnswer {
  const parts: string[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(payload);
    } catch {
      try {
        obj = JSON.parse(`[${payload}]`);
      } catch {
        continue;
      }
    }
    collectTxt(obj, parts);
  }
  return { response: parts.join(""), docs: [], raw: text };
}

async function parseChatResponse(resp: Response): Promise<AgentAnswer> {
  const ctype = (resp.headers.get("content-type") ?? "").toLowerCase();
  const text = await resp.text();
  if (ctype.includes("text/event-stream")) return parseSse(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const t = text.trim();
    return { response: t, docs: [], raw: t };
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    let o = data as Record<string, unknown>;
    let rpc = false;
    // JSON-RPC 2.0 envelope: raise the error, else unwrap `result` and score that.
    if (o.jsonrpc !== undefined || o.error !== undefined || o.result !== undefined) {
      rpc = true;
      if (o.error && typeof o.error === "object") {
        const e = o.error as Record<string, unknown>;
        const detail = e.data === undefined ? "" : ` ${JSON.stringify(e.data)}`;
        throw new Error(`RPC error ${String(e.code ?? "")}: ${String(e.message ?? "")}${detail}`);
      }
      const result = o.result;
      if (result !== undefined) {
        if (result && typeof result === "object" && !Array.isArray(result)) {
          o = result as Record<string, unknown>;
        } else {
          const txt = typeof result === "string" ? result : JSON.stringify(result);
          return { response: txt, docs: [], raw: Array.isArray(result) ? result : txt };
        }
      }
    }
    // A2A results carry the reply as message/artifact `parts`, not a `response` key.
    if (rpc) {
      const parts: string[] = [];
      collectParts(o, parts);
      if (parts.length) return { response: parts.join(""), docs: normalizeDocs(o.docs), raw: o };
    }
    // Endpoints that reply with a different envelope (no `response` key, e.g.
    // {header, body}) keep their whole JSON as the answer so 정답 일치 can
    // compare it instead of scoring an empty string.
    return {
      response: o.response !== undefined ? String(o.response) : JSON.stringify(o),
      docs: normalizeDocs(o.docs),
      raw: o,
    };
  }
  return { response: String(data), docs: [], raw: data as string };
}

function requestHeaders(
  side?: FlowSide | null,
  authKey?: string | null,
  userId?: string | null,
): Record<string, string> {
  const a = getAgentConfig();
  const ak = (authKey ?? getFlowAuthKey(side)).trim();
  const uid = (userId ?? a.userId).trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ak) headers[a.authHeader || "auth-key"] = ak;
  if (uid) headers[a.userHeader || "user-id"] = uid;
  return headers;
}

/** Body for the plain chat endpoint (protocol=chat). */
function chatPayload(message: string, uid: string, traceId: string): Record<string, unknown> {
  return {
    message,
    user_id: uid,
    session_id: "",
    chat_type: "default",
    a2a_remote_urls: null,
    is_super_agent: null,
    main_model_name: null,
    // A STRING that is a stringified JSON object — the agent json.loads it.
    session_system_prompt: JSON.stringify(sessionContext(uid, traceId)),
  };
}

/** Body for the gaia gateway (protocol=gaia) — takes `query` instead of `message`
 * and wants the gaia channel fields plus the URL it was called on. `trace_id`
 * stays empty; the run's id rides in TRACE_ID. */
function gaiaParams(message: string, uid: string, traceId: string, url: string): Record<string, unknown> {
  return {
    query: message,
    user_id: uid,
    session_id: "",
    gaia_session_name: "",
    gaia_input_channel: "api",
    chat_type: "default",
    a2a_remote_urls: null,
    is_super_agent: null,
    main_model_name: null,
    session_system_prompt: JSON.stringify(sessionContext(uid, traceId)),
    request_url: url,
    trace_id: "",
  };
}

/** The gaia endpoint validates the JSON-RPC trio (`jsonrpc`/`id`/`method`) on the
 * SAME level as the body fields — nesting the body under `params` just lands the
 * whole object in the handler's first argument (`query`), so the trio is merged
 * into the flat body instead. */
function gaiaPayload(message: string, uid: string, traceId: string, url: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: traceId,
    method: getAgentConfig().rpcMethod,
    ...gaiaParams(message, uid, traceId, url),
  };
}

function buildPayload(
  protocol: AgentProtocol,
  message: string,
  url: string,
  userId?: string | null,
): Record<string, unknown> {
  const uid = userId ?? getAgentConfig().userId;
  const traceId = nextTraceId();
  return protocol === "gaia"
    ? gaiaPayload(message, uid, traceId, url)
    : chatPayload(message, uid, traceId);
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Short "what we actually sent" tag appended to failures — the terminal log is
 * not always visible, so the shape of the request has to reach the UI. */
function sentTag(protocol: AgentProtocol, body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o).join(",");
  const method = typeof o.method === "string" ? ` method=${o.method}` : "";
  const params = o.params && typeof o.params === "object"
    ? ` params=[${Object.keys(o.params as Record<string, unknown>).join(",")}]`
    : "";
  return ` | sent: protocol=${protocol}${method} keys=[${keys}]${params}`;
}

function baseUrl(side?: FlowSide | null): string {
  const url = getFlowBaseUrl(side).trim().replace(/\/+$/, "");
  if (!url) throw badGateway(`agent.baseUrl${side ? side.toUpperCase() : ""} is not set (config.yml)`);
  return url;
}

export function ensureDirectUrl(override?: string | null): string {
  const url = (override || getFlowBaseUrl("a")).trim().replace(/\/+$/, "");
  if (!url) {
    throw badGateway(
      "호출할 외부 API URL이 없습니다 — 요청에 base_url을 넣거나 config.yml 의 agent.baseUrl 을 설정하세요",
    );
  }
  return url;
}

/** POST one turn to the external chat endpoint (RUN_MODE=external).
 * ``urlOverride`` pins this call to a specific endpoint; otherwise the side's
 * configured endpoint is used (agent.baseUrlA / agent.baseUrlB). */
export async function runFlow(message: string, urlOverride?: string | null, side?: FlowSide | null): Promise<AgentAnswer> {
  // Kept outside the try so a failure can log exactly what went on the wire.
  let url = "";
  let body: unknown = null;
  const protocol = getFlowProtocol(side);
  try {
    url = urlOverride ? ensureDirectUrl(urlOverride) : baseUrl(side);
    body = buildPayload(protocol, message, url);
    const resp = await post(url, body, requestHeaders(side));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const parsed = await parseChatResponse(resp);
    return { response: parsed.response, docs: parsed.docs };
  } catch (e) {
    logger.error("chat run failed", {
      side: side ?? null,
      protocol,
      url,
      body: body === null ? null : JSON.stringify(body),
      err: String(e),
    });
    throw badGateway(`chat run failed: ${String(e)}${sentTag(protocol, body)}`);
  }
}

/** One-shot direct call — no DB, no scoring; caller may override URL/auth/user. */
export async function runDirect(args: {
  message: string;
  baseUrl?: string | null;
  authKey?: string | null;
  userId?: string | null;
}): Promise<AgentAnswer> {
  const url = ensureDirectUrl(args.baseUrl);
  const protocol = getFlowProtocol("a");
  const body = buildPayload(protocol, args.message, url, args.userId);
  try {
    const resp = await post(url, body, requestHeaders("a", args.authKey, args.userId));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await parseChatResponse(resp);
  } catch (e) {
    logger.error("direct call failed", { protocol, url, body: JSON.stringify(body), err: String(e) });
    throw badGateway(`direct call failed: ${String(e)}${sentTag(protocol, body)}`);
  }
}

/** Deterministic in-process stand-in for runFlow (no external endpoint). */
export function stubRunFlow(message: string): AgentAnswer {
  return { response: `[stub answer] ${message}`.trim(), docs: [] };
}

/** One flow answer. A URL typed into the UI always wins (and is called even in
 * stub mode); otherwise the side's configured endpoint is used when external is
 * enabled, else the stub. */
export async function flowAnswer(
  message: string,
  urlOverride?: string | null,
  side?: FlowSide | null,
): Promise<AgentAnswer> {
  // The side still decides the protocol even when the URL is typed in the UI.
  if (urlOverride) return runFlow(message, urlOverride, side);
  if (externalEnabled()) return runFlow(message, null, side);
  return stubRunFlow(message);
}
