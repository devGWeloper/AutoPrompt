import {
  getAgentConfig,
  getFlowAuthKey,
  getFlowBaseUrl,
  getFlowProtocol,
  type AgentProtocol,
} from "@/lib/config";
import { ApiError, badGateway, errorText } from "@/lib/http";
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

/** Seed the counter from the wall clock (centiseconds since midnight) so a
 * restart cannot reissue ids an earlier process already used. That matters
 * because the agent stores captured variables in PTX_TRACE_HIS under this id: a
 * reused id would let a stale row be read back as this call's value. */
function seedSeq(d: Date): number {
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 100;
}

/** ``PM-YYYYMMDD-NNNN`` — monotonic within a day, across restarts. */
function nextTraceId(): string {
  const d = new Date();
  const day =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}`;
  if (day !== traceDay) {
    traceDay = day;
    traceSeq = seedSeq(d);
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
  /** TRACE_ID sent with this call — the key the agent writes PTX_TRACE_HIS under. */
  traceId?: string;
}

/** Failures carry the TRACE_ID too: a node can commit its captured variable and
 * then die further down the flow, and that run is still scorable. */
export function errorTraceId(e: unknown): string | null {
  const t = (e as { traceId?: unknown } | null)?.traceId;
  return typeof t === "string" && t ? t : null;
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

/** The A2A `Message` — the one field `SendMessageRequest` requires under `params`
 * ("1 validation error for SendMessageRequest params.message"). The question
 * travels as text parts, not as a plain string. */
function a2aMessage(message: string, traceId: string): Record<string, unknown> {
  return {
    role: "user",
    parts: [{ kind: "text", text: message }],
    messageId: traceId,
    kind: "message",
  };
}

/** The gaia endpoint speaks standard A2A `message/send`: the JSON-RPC trio at the
 * top level and a `params.message` object. The gaia body fields cannot sit
 * directly under `params` (the request model only knows message/configuration/
 * metadata and pushes anything else into the handler's first argument), so they
 * ride in `params.metadata`. */
function gaiaPayload(message: string, uid: string, traceId: string, url: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: traceId,
    method: getAgentConfig().rpcMethod,
    params: {
      message: a2aMessage(message, traceId),
      metadata: gaiaParams(message, uid, traceId, url),
    },
  };
}

/** The request body plus the TRACE_ID embedded in it — the caller needs the id to
 * look up whatever the agent captured mid-flow. */
function buildPayload(
  protocol: AgentProtocol,
  message: string,
  url: string,
  userId?: string | null,
): { body: Record<string, unknown>; traceId: string } {
  const uid = userId ?? getAgentConfig().userId;
  const traceId = nextTraceId();
  const body =
    protocol === "gaia" ? gaiaPayload(message, uid, traceId, url) : chatPayload(message, uid, traceId);
  return { body, traceId };
}

const CALL_TIMEOUT_MS = 60000;

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Response> {
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

/** Node hides the real reason a fetch died inside `error.cause.code`; the surface
 * message is just "fetch failed". These are the codes worth naming. */
const NET_CODES: Record<string, string> = {
  ECONNREFUSED: "연결이 거부되었습니다 — 주소·포트가 맞는지, 서버가 떠 있는지 확인하세요",
  ENOTFOUND: "호스트를 찾을 수 없습니다 — URL의 호스트명을 확인하세요",
  EAI_AGAIN: "DNS 조회에 실패했습니다",
  ECONNRESET: "연결이 상대 쪽에서 끊겼습니다",
  ETIMEDOUT: "연결 시간이 초과되었습니다",
  EHOSTUNREACH: "호스트에 도달할 수 없습니다 — 네트워크·방화벽을 확인하세요",
  EPROTO: "프로토콜이 맞지 않습니다 — http/https를 확인하세요",
  CERT_HAS_EXPIRED: "서버 인증서가 만료되었습니다",
  DEPTH_ZERO_SELF_SIGNED_CERT: "자체 서명 인증서라 TLS 검증에 실패했습니다",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "인증서 체인을 검증할 수 없습니다",
};

/** One actionable sentence for whatever went wrong on the wire. */
function describeCallError(e: unknown): string {
  if (e instanceof ApiError) return errorText(e);
  if (e instanceof Error) {
    // The abort is ours: `post` fires it when the timeout elapses.
    if (e.name === "AbortError" || e.name === "TimeoutError") {
      return `응답 시간 초과 (${Math.round(CALL_TIMEOUT_MS / 1000)}초) — 엔드포인트가 제때 응답하지 않았습니다`;
    }
    const code = (e as { cause?: { code?: unknown } }).cause?.code;
    if (typeof code === "string") return `${NET_CODES[code] ?? "네트워크 오류"} (${code})`;
    return e.message || String(e);
  }
  return String(e);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A non-2xx reply, with the body — the endpoint's own explanation of the
 * refusal ("field required", a stack trace, a gateway notice) is the whole
 * point; `HTTP 500` on its own tells nobody anything. */
async function httpError(resp: Response, protocol: AgentProtocol, body: unknown): Promise<Error> {
  const text = oneLine(await resp.text().catch(() => ""));
  const status = `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`;
  // A rejected request shape is the usual cause of 400/422, so those — and only
  // those — are worth telling the user what we actually sent.
  const sent = resp.status === 400 || resp.status === 422 ? sentTag(protocol, body) : "";
  return new Error(`${status}${text ? ` — ${text.slice(0, 500)}` : ""}${sent}`);
}

/** Short "what we actually sent" tag appended to failures — the terminal log is
 * not always visible, so the shape of the request has to reach the UI. */
function sentTag(protocol: AgentProtocol, body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o).join(",");
  const method = typeof o.method === "string" ? ` method=${o.method}` : "";
  let params = "";
  if (o.params && typeof o.params === "object") {
    const p = o.params as Record<string, unknown>;
    params = ` params=[${Object.keys(p).join(",")}]`;
    if (p.metadata && typeof p.metadata === "object") {
      params += ` metadata=[${Object.keys(p.metadata as Record<string, unknown>).join(",")}]`;
    }
  }
  return ` | sent: protocol=${protocol}${method} keys=[${keys}]${params}`;
}

/** `fetch` only takes absolute URLs; a host written without a scheme fails as
 * "Failed to parse URL from …", naming the path rather than the setting. */
function requireScheme(url: string, where: string): string {
  if (!/^https?:\/\//i.test(url)) {
    throw badGateway(`${where} 에 http:// 또는 https:// 가 없습니다 (현재: "${url}")`);
  }
  return url;
}

function baseUrl(side?: FlowSide | null): string {
  const setting = `agent.baseUrl${side ? side.toUpperCase() : ""}`;
  const url = getFlowBaseUrl(side).trim().replace(/\/+$/, "");
  if (!url) throw badGateway(`${setting} 이 설정되어 있지 않습니다 (config.yml)`);
  return requireScheme(url, setting);
}

export function ensureDirectUrl(override?: string | null): string {
  const url = (override || getFlowBaseUrl("a")).trim().replace(/\/+$/, "");
  if (!url) {
    throw badGateway(
      "호출할 외부 API URL이 없습니다 — 요청에 base_url을 넣거나 config.yml 의 agent.baseUrl 을 설정하세요",
    );
  }
  return requireScheme(url, override ? "입력한 Base URL" : "agent.baseUrl");
}

/** POST one turn to the external chat endpoint (RUN_MODE=external).
 * ``urlOverride`` pins this call to a specific endpoint; otherwise the side's
 * configured endpoint is used (agent.baseUrlA / agent.baseUrlB). */
export async function runFlow(message: string, urlOverride?: string | null, side?: FlowSide | null): Promise<AgentAnswer> {
  // Kept outside the try so a failure can log exactly what went on the wire.
  let url = "";
  let body: unknown = null;
  let traceId = "";
  const protocol = getFlowProtocol(side);
  try {
    url = urlOverride ? ensureDirectUrl(urlOverride) : baseUrl(side);
    ({ body, traceId } = buildPayload(protocol, message, url));
    const resp = await post(url, body, requestHeaders(side));
    if (!resp.ok) throw await httpError(resp, protocol, body);
    const parsed = await parseChatResponse(resp);
    return { response: parsed.response, docs: parsed.docs, traceId };
  } catch (e) {
    logger.error("chat run failed", {
      side: side ?? null,
      protocol,
      url,
      body: body === null ? null : JSON.stringify(body),
      err: String(e),
      sent: sentTag(protocol, body),
    });
    const err = badGateway(`답변 호출 실패 — ${describeCallError(e)}${url ? ` (${url})` : ""}`);
    // Carried so a run whose call died can still score a variable the agent
    // committed before it failed.
    (err as ApiError & { traceId?: string }).traceId = traceId;
    throw err;
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
  const { body, traceId } = buildPayload(protocol, args.message, url, args.userId);
  try {
    const resp = await post(url, body, requestHeaders("a", args.authKey, args.userId));
    if (!resp.ok) throw await httpError(resp, protocol, body);
    return { ...(await parseChatResponse(resp)), traceId };
  } catch (e) {
    logger.error("direct call failed", {
      protocol,
      url,
      body: JSON.stringify(body),
      err: String(e),
      sent: sentTag(protocol, body),
    });
    throw badGateway(`답변 호출 실패 — ${describeCallError(e)} (${url})`);
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
