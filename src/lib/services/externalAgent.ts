import { getAgentConfig } from "@/lib/config";
import { badGateway } from "@/lib/http";

// Hardcoded session context sent as ``session_system_prompt`` (a STRING that is a
// stringified JSON object — the agent json.loads it to read CUBE_CHANNEL_ID & co).
const SESSION_SYSTEM_PROMPT = JSON.stringify({
  CUBE_CHANNEL_ID: "509108549",
  CUBE_USER_ID: "2074340",
  CUBE_USER_NM: "김태윤",
  TRACE_ID: "AI-20260416-171758-44399577",
});

export interface AgentAnswer {
  response: string;
  docs: string[];
  raw?: Record<string, unknown> | unknown[] | string;
}

export function externalEnabled(): boolean {
  const a = getAgentConfig();
  return a.runMode === "external" && a.baseUrl.length > 0;
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
    const o = data as Record<string, unknown>;
    return {
      response: String(o.response ?? ""),
      docs: normalizeDocs(o.docs),
      raw: o,
    };
  }
  return { response: String(data), docs: [], raw: data as string };
}

function requestHeaders(authKey?: string | null, userId?: string | null): Record<string, string> {
  const a = getAgentConfig();
  const ak = (authKey ?? a.authKey).trim();
  const uid = (userId ?? a.userId).trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ak) headers[a.authHeader || "auth-key"] = ak;
  if (uid) headers[a.userHeader || "user-id"] = uid;
  return headers;
}

function chatPayload(message: string, userId?: string | null): Record<string, unknown> {
  const a = getAgentConfig();
  return {
    message,
    user_id: userId ?? a.userId,
    session_id: "",
    chat_type: "default",
    a2a_remote_urls: null,
    is_super_agent: null,
    main_model_name: null,
    session_system_prompt: SESSION_SYSTEM_PROMPT,
  };
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

function baseUrl(): string {
  const url = getAgentConfig().baseUrl.trim().replace(/\/+$/, "");
  if (!url) throw badGateway("agent.baseUrl is not set (config.yml)");
  return url;
}

export function ensureDirectUrl(override?: string | null): string {
  const url = (override || getAgentConfig().baseUrl).trim().replace(/\/+$/, "");
  if (!url) {
    throw badGateway(
      "호출할 외부 API URL이 없습니다 — 요청에 base_url을 넣거나 config.yml 의 agent.baseUrl 을 설정하세요",
    );
  }
  return url;
}

/** POST one turn to the external chat endpoint (RUN_MODE=external). */
export async function runFlow(message: string): Promise<AgentAnswer> {
  try {
    const resp = await post(baseUrl(), chatPayload(message), requestHeaders());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const parsed = await parseChatResponse(resp);
    return { response: parsed.response, docs: parsed.docs };
  } catch (e) {
    throw badGateway(`chat run failed: ${String(e)}`);
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
  try {
    const resp = await post(
      url,
      chatPayload(args.message, args.userId),
      requestHeaders(args.authKey, args.userId),
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await parseChatResponse(resp);
  } catch (e) {
    throw badGateway(`direct call failed: ${String(e)}`);
  }
}

/** Deterministic in-process stand-in for runFlow (no external endpoint). */
export function stubRunFlow(message: string): AgentAnswer {
  return { response: `[stub answer] ${message}`.trim(), docs: [] };
}

/** One flow answer: real endpoint when external is enabled, else the stub. */
export async function flowAnswer(message: string): Promise<AgentAnswer> {
  if (externalEnabled()) return runFlow(message);
  return stubRunFlow(message);
}
