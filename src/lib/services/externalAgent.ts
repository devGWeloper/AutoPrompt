import { getAgentConfig, getCallTimeoutMs, getFlowBaseUrl, getFlowHeaders } from "@/lib/config";
import type { EndpointHeader } from "@/lib/types";
import { ApiError, badGateway, errorText, fetchWithTimeout } from "@/lib/http";
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

/** ``PTX-YYYYMMDD-NNNN`` — monotonic within a day, across restarts.
 * Exported because a caller that has to stage something for the agent under this
 * id (PTX_CALL_MAS) needs the id *before* the request goes out. */
export function nextTraceId(): string {
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
  return `PTX-${day}-${String(traceSeq).padStart(4, "0")}`;
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
  return a.runMode === "external" && (a.a.url || a.b.url).length > 0;
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
    // A 200 carrying an `error` object is still a failure — raise it rather than
    // scoring the error body as if it were an answer. The endpoint's own code and
    // message are the whole content of the failure, so both are surfaced.
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>;
      const code = String(e.code ?? "").trim();
      // `data: null` carries nothing; appending it just puts a bare "null" in
      // front of the user.
      const detail =
        e.data === undefined || e.data === null ? "" : ` ${JSON.stringify(e.data)}`;
      throw new Error(
        `엔드포인트 오류${code ? ` ${code}` : ""} — ${String(e.message ?? "")}${detail}`,
      );
    }
    // Some endpoints wrap the payload in `result`; score what is inside it.
    const result = o.result;
    if (result !== undefined) {
      if (result && typeof result === "object" && !Array.isArray(result)) {
        o = result as Record<string, unknown>;
      } else {
        const txt = typeof result === "string" ? result : JSON.stringify(result);
        return { response: txt, docs: [], raw: Array.isArray(result) ? result : txt };
      }
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

/** Content-Type plus the headers of whatever endpoint answers this call.
 * ``registered`` are the headers saved with the endpoint the run picked in the
 * settings registry; without it the side's config headers are used, so a run
 * that names no endpoint behaves exactly as before. ``authKey`` is the key typed
 * into the UI for a one-off call; it overrides the FIRST header's value, that
 * slot being the endpoint's credential. */
function requestHeaders(
  side?: FlowSide | null,
  authKey?: string | null,
  registered?: EndpointHeader[] | null,
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const configured = registered?.length ? registered : getFlowHeaders(side);
  for (const h of configured) headers[h.name] = h.value;
  const override = (authKey ?? "").trim();
  if (override && configured.length) headers[configured[0].name] = override;
  return headers;
}

/** The request body — exactly these five keys, the endpoint's spec and nothing
 * beyond it — plus the TRACE_ID embedded in it, which the caller needs to look
 * up whatever the agent captured mid-flow. */
function buildPayload(
  message: string,
  userId?: string | null,
  traceId?: string | null,
): { body: Record<string, unknown>; traceId: string } {
  const uid = userId ?? getAgentConfig().userId;
  // A caller that already staged rows under an id passes it in; everyone else
  // gets a fresh one.
  const tid = traceId || nextTraceId();
  return {
    body: {
      message,
      user_id: uid,
      session_id: "",
      chat_type: "default",
      // A STRING that is a stringified JSON object — the agent json.loads it.
      session_system_prompt: JSON.stringify(sessionContext(uid, tid)),
    },
    traceId: tid,
  };
}

/** Read per call rather than captured at module load: the config is reloadable
 * and a run should honour the value in effect when it starts. */
function callTimeoutMs(): number {
  return getCallTimeoutMs();
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = callTimeoutMs(),
): Promise<Response> {
  // fetchWithTimeout, not fetch: it puts connect/headers/body under this same
  // deadline. Plain fetch would give up on the connect after Node's own 10s and
  // report a network error long before the configured limit.
  return fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
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
  ENETUNREACH: "네트워크에 도달할 수 없습니다 — 라우팅·VPN을 확인하세요",
  // undici's own timers. They now use the configured limit too, so hitting one
  // means the wait really was that long — say which stage gave up.
  UND_ERR_CONNECT_TIMEOUT: "접속(TCP 연결) 시간이 초과되었습니다 — 호스트·포트·방화벽을 확인하세요",
  UND_ERR_HEADERS_TIMEOUT: "응답 헤더가 오지 않아 시간이 초과되었습니다",
  UND_ERR_BODY_TIMEOUT: "응답 본문이 끊겨 시간이 초과되었습니다",
  UND_ERR_SOCKET: "연결이 예기치 않게 끊겼습니다",
  EPROTO: "프로토콜이 맞지 않습니다 — http/https를 확인하세요",
  CERT_HAS_EXPIRED: "서버 인증서가 만료되었습니다",
  DEPTH_ZERO_SELF_SIGNED_CERT: "자체 서명 인증서라 TLS 검증에 실패했습니다",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "인증서 체인을 검증할 수 없습니다",
};

/** The wire-level code Node buries under `fetch failed`. It sits one level down
 * in `cause`, except when both IPv4 and IPv6 were tried — then `cause` is an
 * AggregateError and the codes are one level further in. */
function netCode(e: unknown): string | null {
  const cause = (e as { cause?: unknown }).cause;
  const c = cause as { code?: unknown; errors?: { code?: unknown }[] } | undefined;
  if (typeof c?.code === "string") return c.code;
  for (const sub of c?.errors ?? []) {
    if (typeof sub?.code === "string") return sub.code;
  }
  return null;
}

/** One actionable sentence for whatever went wrong on the wire. */
function describeCallError(e: unknown): string {
  if (e instanceof ApiError) return errorText(e);
  if (e instanceof Error) {
    // The abort is ours: `post` fires it when the timeout elapses.
    if (e.name === "AbortError" || e.name === "TimeoutError") {
      return `응답 시간 초과 (${Math.round(callTimeoutMs() / 1000)}초) — 엔드포인트가 제때 응답하지 않았습니다`;
    }
    const code = netCode(e);
    if (code) return `${NET_CODES[code] ?? "네트워크 오류"} (${code})`;
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
async function httpError(resp: Response, body: unknown): Promise<Error> {
  const text = oneLine(await resp.text().catch(() => ""));
  const status = `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`;
  // A rejected request shape is the usual cause of 400/422, so those — and only
  // those — are worth telling the user what we actually sent.
  const sent = resp.status === 400 || resp.status === 422 ? sentTag(body) : "";
  return new Error(`${status}${text ? ` — ${text.slice(0, 500)}` : ""}${sent}`);
}

/** Short "what we actually sent" tag appended to failures — the terminal log is
 * not always visible, so the shape of the request has to reach the UI. */
function sentTag(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  return ` | sent: keys=[${Object.keys(body as Record<string, unknown>).join(",")}]`;
}

/** `fetch` only takes absolute URLs; a host written without a scheme fails as
 * "Failed to parse URL from …", naming the path rather than the setting. */
function requireScheme(url: string, where: string): string {
  if (!/^https?:\/\//i.test(url)) {
    throw badGateway(`${where} 에 http:// 또는 https:// 가 없습니다 (현재: "${url}")`);
  }
  return url;
}

/** Which config key a side's URL lives under — for error messages only. */
function urlSetting(side?: FlowSide | null): string {
  return `agent.${side === "b" ? "b" : "a"}.url`;
}

function baseUrl(side?: FlowSide | null): string {
  const setting = urlSetting(side);
  const url = getFlowBaseUrl(side).trim().replace(/\/+$/, "");
  if (!url) throw badGateway(`${setting} 이 설정되어 있지 않습니다 (config.yml)`);
  return requireScheme(url, setting);
}

/** ``side`` picks which configured endpoint answers when nothing was typed —
 * a manual A/B compares agent.a.url against agent.b.url. */
export function ensureDirectUrl(override?: string | null, side: FlowSide = "a"): string {
  const url = (override || getFlowBaseUrl(side)).trim().replace(/\/+$/, "");
  const setting = urlSetting(side);
  if (!url) {
    throw badGateway(
      `호출할 외부 API URL이 없습니다 — 요청에 base_url을 넣거나 config.yml 의 ${setting} 을 설정하세요`,
    );
  }
  return requireScheme(url, override ? "입력한 Base URL" : setting);
}

/** POST one turn to the external chat endpoint (RUN_MODE=external).
 * ``urlOverride`` pins this call to a specific endpoint; otherwise the side's
 * configured endpoint is used (agent.a.url / agent.b.url). */
export async function runFlow(
  message: string,
  urlOverride?: string | null,
  side?: FlowSide | null,
  traceIdIn?: string | null,
  headers?: EndpointHeader[] | null,
): Promise<AgentAnswer> {
  // Kept outside the try so a failure can log exactly what went on the wire.
  let url = "";
  let body: unknown = null;
  let traceId = "";
  try {
    url = urlOverride ? ensureDirectUrl(urlOverride) : baseUrl(side);
    ({ body, traceId } = buildPayload(message, null, traceIdIn));
    const resp = await post(url, body, requestHeaders(side, null, headers));
    if (!resp.ok) throw await httpError(resp, body);
    const parsed = await parseChatResponse(resp);
    return { response: parsed.response, docs: parsed.docs, traceId };
  } catch (e) {
    logger.error("chat run failed", {
      side: side ?? null,
      url,
      body: body === null ? null : JSON.stringify(body),
      err: String(e),
      sent: sentTag(body),
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
  /** Which configured endpoint answers when no URL is typed. Only a manual A/B
   * passes 'b'; every other direct call is side A. */
  side?: FlowSide | null;
  /** Headers of the registered endpoint this call picked, when it picked one. */
  headers?: EndpointHeader[] | null;
  /** Pre-issued correlation id when the caller staged rows under it. */
  traceId?: string | null;
}): Promise<AgentAnswer> {
  const side = args.side ?? "a";
  const url = ensureDirectUrl(args.baseUrl, side);
  const { body, traceId } = buildPayload(args.message, args.userId, args.traceId);
  try {
    const resp = await post(url, body, requestHeaders(side, args.authKey, args.headers));
    if (!resp.ok) throw await httpError(resp, body);
    return { ...(await parseChatResponse(resp)), traceId };
  } catch (e) {
    logger.error("direct call failed", {
      side,
      url,
      body: JSON.stringify(body),
      err: String(e),
      sent: sentTag(body),
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
  traceId?: string | null,
  headers?: EndpointHeader[] | null,
): Promise<AgentAnswer> {
  // A picked endpoint brings its own headers; without one the side's config
  // headers decide, even when the URL came from the UI.
  if (urlOverride) return runFlow(message, urlOverride, side, traceId, headers);
  if (externalEnabled()) return runFlow(message, null, side, traceId, headers);
  return stubRunFlow(message);
}
