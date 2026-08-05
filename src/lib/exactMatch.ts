// Exact-match evaluation — "정답 일치". LLM-free: the answer is compared against
// the case's ground truth directly, giving a per-case O/X (1/0). Kept as a pure
// module so both the server (scoring, CSV export) and the client (O/X rendering)
// can use the same rule.
//
// Answers arrive as JSON from the chat API, and only the `body` part is the real
// payload, so both sides are unwrapped to `body` when present. Comparison is
// structural (key order ignored) when both sides parse as JSON, and a
// whitespace-normalized string compare otherwise.

/** Metric key for the exact-match option (a column name once upper-cased). */
export const EXACT_MATCH = "exact_match";

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Unwrap {..., body: X} → X so a ground truth holding only the body matches. */
function unwrapBody(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "body" in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).body;
  }
  return v;
}

/** Stable stringification: object keys sorted, array order preserved. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface Side {
  /** Parsed (and body-unwrapped) JSON value; undefined when not JSON. */
  value: unknown | undefined;
  /** Text form used for the non-JSON comparison path. */
  text: string;
}

function sideOf(raw: string): Side {
  const parsed = parseJson(raw);
  if (parsed === undefined) return { value: undefined, text: raw };
  const value = unwrapBody(parsed);
  return { value, text: typeof value === "string" ? value : canonical(value) };
}

/**
 * Is ``answer`` the same as ``expected``?
 * null when there is no expected answer to compare against (not scored).
 */
export function exactMatch(answer: string | null | undefined, expected: string | null | undefined): boolean | null {
  if (expected == null || !expected.trim()) return null;
  if (answer == null) return false;
  const a = sideOf(answer);
  const e = sideOf(expected);
  if (a.value !== undefined && e.value !== undefined) return canonical(a.value) === canonical(e.value);
  return normalizeText(a.text) === normalizeText(e.text);
}

/** Exact match as the stored 1/0 score (null when not comparable). */
export function exactMatchScore(answer: string | null | undefined, expected: string | null | undefined): number | null {
  const m = exactMatch(answer, expected);
  return m === null ? null : m ? 1 : 0;
}
