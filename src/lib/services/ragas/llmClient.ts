import { getCallTimeoutMs, getCaseDelayMs, getEmbeddingConfig, getLlmConfig } from "@/lib/config";
import { fetchWithTimeout } from "@/lib/http";
import { currentRunSignal } from "@/lib/runSignal";
import { sleep } from "@/lib/sleep";

// Minimal OpenAI-compatible client for the RAGAS judge LLM + embeddings.
// Endpoints are the base URL (e.g. http://host/v1); this appends the standard
// /chat/completions and /embeddings paths. Auth is `Authorization: Bearer <key>`
// when a key is set (empty key → header omitted, for keyless internal gateways).

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 마지막 호출이 끝난 시각. 모듈 스코프라 이 프로세스에서 나가는 모든 모델 호출이
 * 하나의 줄에 선다 — 채점이든 목적 채우기든, 어느 실행에서 불렀든. */
let lastCallDone = 0;
/** 대기하는 순서 자체를 줄 세운다. 이게 없으면 동시에 도착한 두 호출이 같은
 * `lastCallDone` 을 읽고 나란히 통과해, 간격을 두라고 한 바로 그 일이 벌어진다. */
let callQueue: Promise<void> = Promise.resolve();

/**
 * 설정된 간격(`agent.caseDelaySec`)만큼 앞 호출과 사이를 띄우고 `fn` 을 부른다.
 *
 * 간격은 앞 호출이 '끝난' 때부터 잰다. 모델 서버가 연속 호출을 못 받는다는 뜻으로
 * 둔 값이라, 응답을 받자마자 다음 것을 밀어 넣지 않는 쪽이 맞다.
 *
 * 간격이 0이면(기본값) 아무것도 하지 않는다 — 줄도 세우지 않고 그대로 부른다.
 * 0일 때까지 직렬화하면 설정을 안 건드린 사람의 채점이 느려진다.
 *
 * 대기는 취소로 끊긴다. 취소를 눌렀는데 설정해 둔 간격을 다 기다린 뒤에야 멈추면
 * 그건 취소가 아니다.
 */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const gap = getCaseDelayMs();
  if (gap <= 0) return fn();
  const mine = callQueue.then(async () => {
    const wait = lastCallDone + gap - Date.now();
    if (wait > 0) await sleep(wait, currentRunSignal());
    try {
      return await fn();
    } finally {
      // 실패한 호출도 서버를 한 번 두드린 것이다. 다음 것이 곧바로 따라붙지 않게
      // 끝난 시각은 성공 여부와 무관하게 적는다.
      lastCallDone = Date.now();
    }
  });
  // 앞 호출이 실패해도 줄은 계속 흘러야 한다 — 한 번의 오류로 이후 전부가 멈추면
  // 안 된다. 그래서 줄에는 결과도 오류도 남기지 않는다.
  callQueue = mine.then(
    () => undefined,
    () => undefined,
  );
  return mine;
}

/** The judge LLM and the embedding model wait exactly as long as an agent call
 * does — one `agent.timeoutSec` for every outbound request. */
async function postJson(url: string, apiKey: string, body: unknown, timeoutMs = getCallTimeoutMs()): Promise<unknown> {
  return paced(() => postJsonNow(url, apiKey, body, timeoutMs));
}

async function postJsonNow(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  } catch (e) {
    // The abort is ours; a bare "This operation was aborted" names nothing.
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`응답 시간 초과 (${Math.round(timeoutMs / 1000)}초) — ${url}`);
    }
    throw e;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
  return await resp.json();
}

/** Join a configured base URL with an OpenAI path. `fetch` needs an absolute URL:
 * a host written without a scheme ("10.0.0.5:8000/v1") fails deep inside undici
 * as "Failed to parse URL from …/chat/completions", which names the path we
 * appended and never the setting at fault. Say which setting, and what's wrong. */
function apiUrl(base: string, path: string, setting: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(b)) {
    throw new Error(`${setting} 에 http:// 또는 https:// 가 없습니다 (현재: "${base}") — config.yml 을 확인하세요`);
  }
  return `${b}${path}`;
}

export function llmConfigured(): boolean {
  return getLlmConfig().endpoint !== "";
}

export function embeddingConfigured(): boolean {
  return getEmbeddingConfig().endpoint !== "";
}

async function chatComplete(messages: ChatMessage[]): Promise<string> {
  const c = getLlmConfig();
  if (!c.endpoint) throw new Error("LLM endpoint is not configured (config.yml llm.endpoint)");
  if (!c.model) throw new Error("LLM model is not configured (config.yml llm.model)");
  const data = (await postJson(apiUrl(c.endpoint, "/chat/completions", "llm.endpoint"), c.apiKey, {
    model: c.model,
    messages,
    temperature: 0,
  })) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Extract the first JSON object/array from a model reply (tolerating ``` fences). */
function extractJson<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Find the outermost JSON structure.
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === "{" ? "}" : "]";
    const end = t.lastIndexOf(close);
    if (end > start) t = t.slice(start, end + 1);
  }
  return JSON.parse(t) as T;
}

/** Ask the judge LLM for a JSON answer and parse it. */
export async function chatJson<T>(system: string, user: string): Promise<T> {
  const content = await chatComplete([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  return extractJson<T>(content);
}

/** Embed texts via the OpenAI-compatible embeddings endpoint. */
export async function embed(texts: string[]): Promise<number[][]> {
  const c = getEmbeddingConfig();
  if (!c.endpoint) throw new Error("embedding endpoint is not configured (config.yml embedding.endpoint)");
  if (!c.model) throw new Error("embedding model is not configured (config.yml embedding.model)");
  const data = (await postJson(apiUrl(c.endpoint, "/embeddings", "embedding.endpoint"), c.apiKey, {
    model: c.model,
    input: texts,
  })) as {
    data?: { embedding: number[] }[];
  };
  return (data.data ?? []).map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
