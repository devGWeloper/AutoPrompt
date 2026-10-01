// A run stamps the role→model config it started under (PTX_RUN_MAS.MODEL_CTN).
// PTX_MODEL_MAS only holds the *current* value, so without this stamp there is no
// way to tell a "before the model change" run from an "after" one once you come
// back to Records the next day.
//
// Shape: {"LLM": {"model": "qwen3", "temperature": 0.3, "server": "vllm-a",
//                  "base_url": "http://10.0.0.5:8000/v1", "api_key_ref": "VLLM_A_KEY"}}
//   - roles with nothing pinned are absent (they ran the agent's own default)
//   - `temperature` is present only when it was pinned
//   - `server` / `base_url` say which host answered; absent = the agent's own
//     config address. `api_key_ref` is the key's name, never its value
//   - nothing pinned at all → the column is NULL

export interface RunModelEntry {
  model?: string;
  temperature?: number;
  server?: string;
  base_url?: string;
  api_key_ref?: string;
}

export type RunModelSnapshot = Record<string, RunModelEntry>;

export function parseModelSnapshot(raw: string | null | undefined): RunModelSnapshot | null {
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const entries = Object.entries(o as Record<string, unknown>).filter(
      ([, v]) => v && typeof v === "object" && !Array.isArray(v),
    ) as [string, RunModelEntry][];
    return entries.length ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

/** One role's value. undefined = that role was not pinned at all. */
function entryText(e: RunModelEntry | undefined): string | undefined {
  if (!e) return undefined;
  // A role pinned only by temperature still ran the config's model name.
  // 서버는 이름만 — 같은 모델을 다른 서버로 돌린 두 실행이 기록에서 구별되어야
  // 하고, 전체 주소는 한 줄 요약에 들어가기엔 길다.
  return `${e.model ?? "기본값"}${e.server ? `@${e.server}` : ""}${
    e.temperature !== undefined ? ` (t${e.temperature})` : ""
  }`;
}

/** `LLM=qwen3 · VLM=x (t0.3)` — compact enough for a table subline. */
export function formatModelSnapshot(raw: string | null | undefined): string | null {
  const parsed = parseModelSnapshot(raw);
  if (!parsed) return null;
  return Object.entries(parsed)
    .map(([role, e]) => `${role}=${entryText(e)}`)
    .join(" · ");
}

/**
 * The two sides of a comparison. Identical configs read as one line; when they
 * differ, only the roles that differ are shown — that difference is the point of
 * the run, and repeating the roles both sides share would bury it.
 */
export function formatModelPair(
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
): string | null {
  const a = parseModelSnapshot(aRaw) ?? {};
  const b = parseModelSnapshot(bRaw) ?? {};
  const roles = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  const differing = roles.filter((r) => entryText(a[r]) !== entryText(b[r]));
  if (!differing.length) return formatModelSnapshot(aRaw);
  return differing
    .map((r) => `${r}: A=${entryText(a[r]) ?? "기본값"} vs B=${entryText(b[r]) ?? "기본값"}`)
    .join(" · ");
}
