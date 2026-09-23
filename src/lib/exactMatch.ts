// Action Test — the LLM-free evaluation option. The scored value (the captured
// variable when the node recorded one, else the final answer) is compared with
// the case's ground truth, and the case passes only when the two are the same:
// 일치 / 불일치, stored as 1/0. Kept as a pure module so the server (scoring,
// export) and the client (the key table) decide from one rule.
//
// Answers arrive as JSON from the chat API, and only the `body` part is the real
// payload, so both sides are unwrapped to `body` when present. Two structures
// are then compared key by key — see the field walk at the bottom of the file,
// which is what `exactMatch` itself is decided from: key order never matters, a
// missing or invented key does, and a type change is called out as its own kind
// of failure. Anything without structure on both sides (prose, a bare scalar,
// one side that is not JSON at all) falls back to a whole-text comparison.
// Either way whitespace is ignored — indentation, newlines and padding inside
// string values never decide the result.

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
  // Anything with structure on either side is decided by the field walk below,
  // so the key table on screen and this verdict are one calculation rather than
  // two that have to be kept in step. Everything else — one side not JSON, or
  // both a bare scalar — is still judged whole.
  const structured = structuredMatch(answer, expected, opts);
  if (structured) return structured.ok;
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

// ---------------------------------------------------------------------------
// Field-level comparison
//
// The verdict above answers "같은가?" and nothing more. When both sides are JSON
// structures — which is what the captured `parsed` variable always is — that one
// bit hides the only thing worth knowing: WHICH key went wrong, and how. So the
// same rule is also exposed as a walk over the two trees, one row per leaf:
// a key the answer never produced, a key it invented, a value of the wrong type,
// a value that simply differs. `exactMatch` is decided from this walk, so the
// table on screen can never disagree with the O it sits under.
// ---------------------------------------------------------------------------

/** Why one key stands where it does. Only "match" passes. */
export type FieldStatus =
  /** Same key, same value. */
  | "match"
  /** Same key and type, different value. */
  | "diff"
  /** Same key, different JSON type (`"200"` vs `200`, object vs array …). */
  | "type"
  /** Expected the key; the answer has no such key. */
  | "missing"
  /** The answer carries a key the expected answer never asked for. */
  | "extra";

export interface FieldResult {
  /** Dotted path from the root — `slots.date`, `items[0].id`, `""` at the root. */
  path: string;
  /** The same path as its own pieces — `["items", "[0]", "id"]`, empty at the
   * root. Display only, and the reason it is carried rather than re-derived:
   * the table indents and groups by depth, and a key that itself contains a dot
   * would make splitting `path` on screen a guess. */
  segs: string[];
  status: FieldStatus;
  /** One-line display forms; null on the side that has no value at all. */
  expected: string | null;
  actual: string | null;
}

export interface StructuredMatch {
  /** Expected-answer order first, then keys only the answer had. */
  fields: FieldResult[];
  matched: number;
  total: number;
  /** Every field matched — the same boolean `exactMatch` returns. */
  ok: boolean;
}

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === "object";
}

/** JSON type name, with null and array split out of `typeof`'s "object". */
function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** A value as one line of display text. Strings are shown bare — quoting every
 * leaf makes the table read like source instead of like values.
 *
 * `quoted` is for the one row where that would lie: a type mismatch between
 * `200` and `"200"` renders as the same three characters twice unless the string
 * keeps its quotes, and the reader is left staring at two identical cells under
 * the word '타입 다름'. */
function leafText(v: unknown, quoted = false): string {
  if (typeof v === "string") return quoted ? JSON.stringify(normalizeText(v)) : normalizeText(v);
  if (isContainer(v)) return canonical(v);
  return JSON.stringify(v) ?? "null";
}

function walk(actual: unknown, expected: unknown, path: string, segs: string[], out: FieldResult[]): void {
  const row = (status: FieldStatus): void => {
    const q = status === "type";
    out.push({ path, segs, status, expected: leafText(expected, q), actual: leafText(actual, q) });
  };

  if (typeName(actual) !== typeName(expected)) return row("type");

  if (Array.isArray(actual) && Array.isArray(expected)) {
    // Position is the identity of an array element here — there is no key to
    // pair them by, and reordering a list IS a difference for this judgement.
    const n = Math.max(actual.length, expected.length);
    if (n === 0) return row("match");
    for (let i = 0; i < n; i++) {
      const seg = `[${i}]`;
      const p = `${path}${seg}`;
      const s = [...segs, seg];
      if (i >= expected.length) out.push({ path: p, segs: s, status: "extra", expected: null, actual: leafText(actual[i]) });
      else if (i >= actual.length) out.push({ path: p, segs: s, status: "missing", expected: leafText(expected[i]), actual: null });
      else walk(actual[i], expected[i], p, s, out);
    }
    return;
  }

  if (isContainer(actual) && isContainer(expected)) {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    // Expected order first so the table reads like the ground truth was written;
    // keys only the answer produced are appended, never interleaved.
    const keys = [...Object.keys(e), ...Object.keys(a).filter((k) => !(k in e))];
    if (keys.length === 0) return row("match");
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      const s = [...segs, k];
      if (!(k in a)) out.push({ path: p, segs: s, status: "missing", expected: leafText(e[k]), actual: null });
      else if (!(k in e)) out.push({ path: p, segs: s, status: "extra", expected: null, actual: leafText(a[k]) });
      else walk(a[k], e[k], p, s, out);
    }
    return;
  }

  if (typeof actual === "string" && typeof expected === "string") {
    return row(normalizeText(actual) === normalizeText(expected) ? "match" : "diff");
  }
  row(Object.is(actual, expected) ? "match" : "diff");
}

/**
 * The two sides compared key by key, or null when there is nothing structural to
 * compare — no expected answer, no answer, either side not JSON, or both sides a
 * bare scalar. A null hands the judgement back to the whole-text comparison.
 */
export function structuredMatch(
  answer: string | null | undefined,
  expected: string | null | undefined,
  opts: MatchOpts = {},
): StructuredMatch | null {
  if (expected == null || !expected.trim() || answer == null) return null;
  const unwrap = opts.unwrapBody !== false;
  const a = sideOf(answer, unwrap);
  const e = sideOf(expected, unwrap);
  if (a.value === undefined || e.value === undefined) return null;
  if (!isContainer(a.value) && !isContainer(e.value)) return null;
  const fields: FieldResult[] = [];
  walk(a.value, e.value, "", [], fields);
  const matched = fields.filter((f) => f.status === "match").length;
  return { fields, matched, total: fields.length, ok: matched === fields.length };
}

// ---- 값 한쪽의 뼈대 ----
//
// `walk` 은 두 쪽을 견준다. 그런데 한 폴더에 든 정답지 스무 건을 나란히 세워 두고
// "어느 키가 갈리는가" 를 보려면 한 쪽만 펴는 손이 따로 있어야 한다 — 목적 축
// 분석(services/purposeAxes)이 쓰는 손이다.
//
// 그 손을 굳이 이 파일에 두는 이유는 하나다. 목적에 적히는 키와 키별 판정 표의
// 키가 한 글자라도 다르면, 실패한 키에서 그 키를 확인하려던 목적으로 되짚는 길이
// 끊긴다. path 를 만드는 규칙은 한 군데에만 있어야 한다.

export interface JsonLeaf {
  path: string;
  segs: string[];
  /** 표시용 — 문자열은 따옴표 없이, `walk` 의 기본값과 같다. */
  text: string;
  /** 같은 값인지 가르는 열쇠. 문자열은 따옴표째라 `200` 과 `"200"` 이 한 값으로
   * 뭉뚱그려지지 않는다 — 그 둘이 갈리는 것 자체가 시험 지점일 수 있다. */
  key: string;
  /** null 과 array 가 갈라져 나온 JSON 타입 이름. */
  type: string;
}

export interface JsonShape {
  /** 잎 하나당 한 줄. 빈 객체와 빈 배열은 그 자체가 잎이다 — `walk` 도 거기서
   * 더 내려가지 않고 한 줄을 만든다. */
  leaves: JsonLeaf[];
  /** 배열 노드의 path → 길이. 노드지 잎이 아니라 `leaves` 에는 없다. */
  arrays: Map<string, number>;
}

function shapeWalk(v: unknown, path: string, segs: string[], out: JsonShape): void {
  const leaf = (): void => {
    out.leaves.push({
      path,
      segs,
      text: leafText(v),
      key: leafText(v, true),
      type: typeName(v),
    });
  };

  if (Array.isArray(v)) {
    out.arrays.set(path, v.length);
    if (v.length === 0) return leaf();
    for (let i = 0; i < v.length; i++) {
      shapeWalk(v[i], `${path}[${i}]`, [...segs, `[${i}]`], out);
    }
    return;
  }

  if (isContainer(v)) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return leaf();
    for (const k of keys) shapeWalk(o[k], path ? `${path}.${k}` : k, [...segs, k], out);
    return;
  }

  leaf();
}

/** 값 하나를 잎 목록과 배열 길이로 편다. path 표기는 `walk` 과 같다 — `a.b`,
 * `items[0].id`, 그리고 맨 위는 빈 문자열. */
export function jsonShape(value: unknown): JsonShape {
  const out: JsonShape = { leaves: [], arrays: new Map() };
  shapeWalk(value, "", [], out);
  return out;
}

/** 텍스트 한쪽의 파싱된(그리고 `body` 가 벗겨진) JSON 값. JSON 이 아니면
 * undefined — `structuredMatch` 가 정답지를 읽는 규칙 그대로다. */
export function jsonValueOf(raw: string, opts: MatchOpts = {}): unknown | undefined {
  return sideOf(raw, opts.unwrapBody !== false).value;
}
