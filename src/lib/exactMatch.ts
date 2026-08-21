// Exact-match evaluation — "정답 일치". LLM-free: the answer is compared against
// the case's ground truth directly, giving a per-case O/X (1/0). Kept as a pure
// module so both the server (scoring, CSV export) and the client (O/X rendering)
// can use the same rule.
//
// Answers arrive as JSON from the chat API, and only the `body` part is the real
// payload, so both sides are unwrapped to `body` when present. Comparison is
// structural (key order ignored) when both sides parse as JSON, and a string
// compare otherwise. Either way whitespace is ignored — indentation, newlines
// and padding inside string values never decide the result.

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

/** Whitespace is never meaningful for this judgement: runs collapse to a single
 * space and the ends are trimmed. Pretty-printed vs compact JSON, an indented
 * ground truth pasted from the result screen, and padding inside a value all
 * compare equal — only the text itself decides O/X. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Stable stringification: object keys sorted, array order preserved, every
 * string leaf whitespace-normalized. */
function canonical(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(normalizeText(v));
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(normalizeText(k))}:${canonical(o[k])}`)
    .join(",")}}`;
}

interface Side {
  /** Parsed (and body-unwrapped) JSON value; undefined when not JSON. */
  value: unknown | undefined;
  /** Text form used for the non-JSON comparison path. */
  text: string;
}

function sideOf(raw: string, unwrap: boolean): Side {
  const parsed = parseJson(raw);
  if (parsed === undefined) return { value: undefined, text: raw };
  const value = unwrap ? unwrapBody(parsed) : parsed;
  return { value, text: typeof value === "string" ? value : canonical(value) };
}

export interface MatchOpts {
  /** Unwrap a top-level `body` key before comparing. True for a final answer
   * (the endpoint's envelope); MUST be false for a traced variable, whose own
   * `body` key is real data — unwrapping it there hides every other key and
   * turns `{body:1,code:200}` vs `{body:1,code:500}` into a false match. */
  unwrapBody?: boolean;
}

/**
 * Is ``answer`` the same as ``expected``?
 * null when there is no expected answer to compare against (not scored).
 */
export function exactMatch(
  answer: string | null | undefined,
  expected: string | null | undefined,
  opts: MatchOpts = {},
): boolean | null {
  const unwrap = opts.unwrapBody !== false;
  if (expected == null || !expected.trim()) return null;
  if (answer == null) return false;
  const a = sideOf(answer, unwrap);
  const e = sideOf(expected, unwrap);
  if (a.value !== undefined && e.value !== undefined) return canonical(a.value) === canonical(e.value);
  return normalizeText(a.text) === normalizeText(e.text);
}

/** Exact match as the stored 1/0 score (null when not comparable). */
export function exactMatchScore(
  answer: string | null | undefined,
  expected: string | null | undefined,
  opts: MatchOpts = {},
): number | null {
  const m = exactMatch(answer, expected, opts);
  return m === null ? null : m ? 1 : 0;
}

/** The two texts to put side by side on the result screen, in the form the
 * verdict was decided from. */
export interface ComparePair {
  left: string;
  right: string;
  /** Both sides were JSON and are shown re-formatted (keys sorted, indented) —
   * the form that was actually compared, so key order and indentation cannot
   * look like a difference when the verdict says they are not. */
  json: boolean;
}

/** Canonical JSON re-expanded for reading. Falls back to the compact form if it
 * somehow does not parse back. */
function pretty(canon: string): string {
  try {
    return JSON.stringify(JSON.parse(canon), null, 2);
  } catch {
    return canon;
  }
}

/**
 * The two operands of :func:`exactMatch`, as text to display.
 *
 * Plain text is handed back untouched — whitespace is the only thing
 * normalization would strip, and the diff ignores whitespace anyway, so the
 * screen can show the answer as it was written. JSON is shown canonicalised,
 * which is both what was compared and easier to read than one long line.
 */
export function comparablePair(
  answer: string | null | undefined,
  expected: string | null | undefined,
  opts: MatchOpts = {},
): ComparePair {
  const raw = { left: answer ?? "", right: expected ?? "" };
  const unwrap = opts.unwrapBody !== false;
  const a = sideOf(raw.left, unwrap);
  const e = sideOf(raw.right, unwrap);
  if (a.value === undefined || e.value === undefined) return { ...raw, json: false };
  // A JSON payload whose body is just a string is prose, not a structure.
  if (typeof a.value === "string" && typeof e.value === "string") {
    return { left: a.value, right: e.value, json: false };
  }
  return { left: pretty(canonical(a.value)), right: pretty(canonical(e.value)), json: true };
}
