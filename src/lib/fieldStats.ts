// The same key comparison, read down the run instead of across one case.
//
// The per-case table answers "이 케이스는 왜 틀렸나". The question it cannot
// answer is the one a dataset of forty cases is actually run to ask: 어떤 키가
// 자주 깨지나. That has to be read by opening forty cases one at a time and
// remembering what each said, which is not reading — so the walk is run once per
// case and the leaves are counted by path.
//
// Pure, and client-side: every case already carries the two texts, and the walk
// that judges them is the same `structuredMatch` the table draws from. Nothing
// new is stored, nothing is asked of the server, and the numbers here can never
// disagree with the per-case tables below them.

import { structuredMatch, type FieldResult, type FieldStatus } from "./exactMatch";
import type { RagasResultRow } from "./types";

/** One case's contribution to a key — what it produced, and where to find it. */
export interface KeyCase {
  resultId: number;
  question: string | null;
  status: FieldStatus;
  expected: string | null;
  actual: string | null;
}

export interface KeyStat {
  path: string;
  segs: string[];
  /** Cases in which this key was compared at all. */
  total: number;
  matched: number;
  counts: Record<FieldStatus, number>;
  /** The cases that did not match, in run order. */
  fails: KeyCase[];
}

const zero = (): Record<FieldStatus, number> => ({ match: 0, diff: 0, type: 0, missing: 0, extra: 0 });

/** 채점된 값은 중간 변수가 있으면 그것, 없으면 최종 답변 — 그리고 중간 변수는
 * 통째로 비교한다(자기 `body` 키는 봉투가 아니라 데이터다). 화면 여러 곳이
 * 같은 규칙을 따로 적고 있어, 집계도 그 규칙을 그대로 쓴다. */
export function scoredFields(row: RagasResultRow) {
  const m = structuredMatch(row.trace_value ?? row.answer ?? "", row.ground_truth ?? "", {
    unwrapBody: !row.trace_value,
  });
  if (!m || !row.passed) return m;
  // 사람이 통과시킨 케이스는 키가 다 맞은 것으로 친다. 통과 처리는 "이 건은 이대로
  // 맞다" 는 판단이고, 그 판단 뒤에도 '누락 3건' 이 집계에 남아 있으면 이 판이
  // 사람의 결론과 다른 말을 하게 된다 — 고치러 갈 곳을 가리키는 표인데 이미
  // 고치지 않기로 한 것을 가리키는 셈이다.
  //
  // 케이스별 판정표는 이 함수를 쓰지 않는다. 펼쳐 보면 원래 무엇이 걸렸던 건지는
  // 그대로 읽힌다 — 감춰지는 건 집계에서의 '실패' 취급뿐이다.
  return {
    ...m,
    fields: m.fields.map((f) => (f.status === "match" ? f : { ...f, status: "match" as FieldStatus })),
    matched: m.fields.length,
    ok: true,
  };
}

/** How many of these cases can be read key by key at all. Under two, the
 * breakdown has nothing to aggregate that the case itself does not already say. */
export function structuredCount(rows: RagasResultRow[]): number {
  return rows.reduce((n, r) => n + (scoredFields(r) ? 1 : 0), 0);
}

/**
 * Every key that appeared in the run, worst first.
 *
 * "Worst" is the failure count and not the rate: a key that failed in twelve of
 * forty cases is the one to go fix, and sorting by rate would put a key that was
 * compared once and failed once above it.
 */
export function keyStats(rows: RagasResultRow[]): KeyStat[] {
  const by = new Map<string, KeyStat>();
  for (const row of rows) {
    const m = scoredFields(row);
    if (!m) continue;
    for (const f of m.fields) {
      let s = by.get(f.path);
      if (!s) {
        s = { path: f.path, segs: f.segs, total: 0, matched: 0, counts: zero(), fails: [] };
        by.set(f.path, s);
      }
      s.total++;
      s.counts[f.status]++;
      if (f.status === "match") s.matched++;
      else s.fails.push(caseOf(row, f));
    }
  }
  return [...by.values()].sort(
    (a, b) => b.fails.length - a.fails.length || b.total - a.total || a.path.localeCompare(b.path),
  );
}

function caseOf(row: RagasResultRow, f: FieldResult): KeyCase {
  return {
    resultId: row.ragas_result_id,
    question: row.question,
    status: f.status,
    expected: f.expected,
    actual: f.actual,
  };
}

// ---------------------------------------------------------------------------
// A/B
// ---------------------------------------------------------------------------

/** Which side got this key right, counted over the shared cases. `split` is the
 * only number the compare screen is really run for. */
export interface AbKeyStat {
  path: string;
  segs: string[];
  /** Cases where at least one side compared this key. */
  total: number;
  bothOk: number;
  aOnly: number;
  bOnly: number;
  bothBad: number;
  /** aOnly + bOnly — the cases where the two sides disagreed on this key. */
  split: number;
}

export function abKeyStats(aRows: RagasResultRow[], bRows: RagasResultRow[]): AbKeyStat[] {
  const bByCase = new Map<number | null, RagasResultRow>(bRows.map((r) => [r.case_id, r]));
  const by = new Map<string, AbKeyStat>();
  const get = (f: FieldResult): AbKeyStat => {
    let s = by.get(f.path);
    if (!s) {
      s = { path: f.path, segs: f.segs, total: 0, bothOk: 0, aOnly: 0, bOnly: 0, bothBad: 0, split: 0 };
      by.set(f.path, s);
    }
    return s;
  };
  for (const a of aRows) {
    const b = bByCase.get(a.case_id);
    if (!b) continue;
    const ma = scoredFields(a);
    const mb = scoredFields(b);
    if (!ma && !mb) continue;
    const bStatus = new Map<string, FieldStatus>(mb?.fields.map((f) => [f.path, f.status]) ?? []);
    const seen = new Set<string>();
    for (const f of ma?.fields ?? []) {
      seen.add(f.path);
      tally(get(f), f.status === "match", bStatus.get(f.path) === "match");
    }
    // A key only B produced still splits the pair — A simply never had it.
    for (const f of mb?.fields ?? []) {
      if (seen.has(f.path)) continue;
      tally(get(f), false, f.status === "match");
    }
  }
  return [...by.values()].sort((a, b) => b.split - a.split || b.bothBad - a.bothBad || a.path.localeCompare(b.path));
}

function tally(s: AbKeyStat, aOk: boolean, bOk: boolean): void {
  s.total++;
  if (aOk && bOk) s.bothOk++;
  else if (aOk) { s.aOnly++; s.split++; }
  else if (bOk) { s.bOnly++; s.split++; }
  else s.bothBad++;
}
