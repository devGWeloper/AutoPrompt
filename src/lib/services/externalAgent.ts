import { getAgentConfig, getCallTimeoutMs, getFlowBaseUrl, getFlowHeaders } from "@/lib/config";
import type { EndpointHeader } from "@/lib/types";
import { ApiError, badGateway, fetchWithTimeout } from "@/lib/http";

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
  /** Request sent → first token of the answer arrived, in ms. Only a streaming
   * (text/event-stream) reply has one: it is the part of the wait that happens
   * before any of the answer is written, so it holds queue time and drops the
   * generation time that makes the total depend on how long the answer got.
   * null when the endpoint answered in a single body. */
  ttftMs?: number | null;
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

/** The answer text carried by ONE `data:` line — "" when the line carries none
 * (a keep-alive, `[DONE]`, or a frame whose payload is metadata rather than
 * text). Shared so the incremental read and the final parse agree on what
 * counts as answer text; TTFT is defined as the first line this returns
 * something for. */
function sseLineText(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return "";
  let obj: unknown;
  try {
    obj = JSON.parse(payload);
  } catch {
    try {
      obj = JSON.parse(`[${payload}]`);
    } catch {
      return "";
    }
  }
  const parts: string[] = [];
  collectTxt(obj, parts);
  return parts.join("");
}

/** Aggregate a text/event-stream reply into {response, docs, raw}. */
function parseSse(text: string): AgentAnswer {
  const parts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = sseLineText(line);
    if (t !== "") parts.push(t);
  }
  return { response: parts.join(""), docs: [], raw: text };
}

/**
 * The response body, plus when its first token of answer text arrived.
 *
 * `resp.text()` would be shorter, but it resolves only once the last byte is
 * in — and by then the moment the answer *started* is gone. Reading the stream
 * chunk by chunk costs nothing extra and recovers TTFT: request sent → first
 * token, which is queue wait + prefill without any of the generation time that
 * dominates the total. The text handed back is byte-for-byte what `text()`
 * would have produced, so every parser below is unaffected.
 *
 * `ttftMs` is null when the endpoint does not stream — one JSON body has no
 * first token, and its arrival time IS its completion time.
 */
async function readBodyTimed(resp: Response, startedAt: number, sse: boolean): Promise<{ text: string; ttftMs: number | null }> {
  if (!resp.body) return { text: await resp.text(), ttftMs: null };
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let pending = ""; // the tail of the last chunk: possibly half a frame
  let ttftMs: number | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      if (!sse || ttftMs !== null) continue;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      // A frame torn across two TCP writes is not a token yet; its tail waits
      // for the rest rather than being parsed as truncated JSON.
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (sseLineText(line) !== "") {
          ttftMs = Date.now() - startedAt;
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  return { text, ttftMs };
}

async function parseChatResponse(resp: Response, startedAt: number): Promise<AgentAnswer> {
  const ctype = (resp.headers.get("content-type") ?? "").toLowerCase();
  const isSse = ctype.includes("text/event-stream");
  const { text, ttftMs } = await readBodyTimed(resp, startedAt, isSse);
  if (isSse) return { ...parseSse(text), ttftMs };
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
        `API 오류${code ? ` ${code}` : ""} — ${String(e.message ?? "")}${detail}`,
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
  return new Error(`${status}${text ? ` — ${text.slice(0, 900)}` : ""}${sent}`);
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
  const url = urlOverride ? ensureDirectUrl(urlOverride) : baseUrl(side);
  const { body, traceId } = buildPayload(message, null, traceIdIn);
  // Started here, immediately before the request goes out — URL building and
  // payload assembly above are ours, and TTFT must not carry them.
  const startedAt = Date.now();
  const resp = await post(url, body, requestHeaders(side, null, headers));
  if (!resp.ok) throw await httpError(resp, body);
  const parsed = await parseChatResponse(resp, startedAt);
  return { response: parsed.response, docs: parsed.docs, traceId, ttftMs: parsed.ttftMs ?? null };
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
  const startedAt = Date.now();
  try {
    const resp = await post(url, body, requestHeaders(side, args.authKey, args.headers));
    if (!resp.ok) throw await httpError(resp, body);
    return { ...(await parseChatResponse(resp, startedAt)), traceId };
  } catch (e) {
    // Carriage, not handling: a raw Error reaching a route handler comes out of
    // `errorResponse` as "internal server error", which throws the endpoint's
    // own words away. Re-thrown with the message untouched so the screen shows
    // what the other side actually said. A dataset run needs none of this — its
    // per-case catch already records the same text.
    if (e instanceof ApiError) throw e;
    throw badGateway(e instanceof Error ? e.message || String(e) : String(e));
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
