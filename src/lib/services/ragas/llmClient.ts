import { getEmbeddingConfig, getLlmConfig } from "@/lib/config";

// Minimal OpenAI-compatible client for the RAGAS judge LLM + embeddings.
// Endpoints are the base URL (e.g. http://host/v1); this appends the standard
// /chat/completions and /embeddings paths. Auth is `Authorization: Bearer <key>`
// when a key is set (empty key → header omitted, for keyless internal gateways).

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function postJson(url: string, apiKey: string, body: unknown, timeoutMs = 90000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${text.slice(0, 300)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
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
  const data = (await postJson(`${c.endpoint}/chat/completions`, c.apiKey, {
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
  const data = (await postJson(`${c.endpoint}/embeddings`, c.apiKey, { model: c.model, input: texts })) as {
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
