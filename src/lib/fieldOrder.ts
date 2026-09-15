// The order the key table is read in.
//
// The expected answer's own key order is the order it was written in, which is
// not the order anyone reads a failed case in. A real payload is thirty to sixty
// keys of which most are schema filler that came back `null` or `""` on both
// sides, and the two or three that decided the X sit wherever the author happened
// to put them. So the default order is by what the reader came for:
//
//   1. 오류      — every key that did not match, the heaviest kind first
//                  (누락 → 타입 → 값 다름 → 추가: structural failures before
//                  content, and '추가' last because it is as often the expected
//                  answer's fault as the node's)
//   2. 값 있음   — matched, and actually carries something
//   3. 값 없음   — matched, and empty on both sides: filler
//
// Within a tier the written order is kept, so the table stays predictable.
//
// "값 없음" is only ever a matched row. A key the answer dropped whose expected
// value was `""` is still the reason the case failed, and hiding blank rows must
// never be able to hide that.

import type { FieldStatus } from "./exactMatch";

/** Display forms that mean "nothing here". `leafText` renders an empty string
 * bare, so `""` arrives as the empty string itself. */
const BLANK = new Set(["", "null", "[]", "{}"]);

export function isBlank(text: string | null): boolean {
  return text === null || BLANK.has(text.trim());
}

export type Tier = "bad" | "value" | "blank";

export const TIER_ORDER: Tier[] = ["bad", "value", "blank"];

/** Which tier a row belongs to. `ok` is whether it matched — for an A/B row that
 * means both sides did. */
export function tierOf(ok: boolean, expected: string | null, ...actuals: (string | null)[]): Tier {
  if (!ok) return "bad";
  return isBlank(expected) && actuals.every(isBlank) ? "blank" : "value";
}

/** Tier first, then `weight` (higher first), then the order they came in. */
export function byImportance<T>(items: T[], tier: (t: T) => Tier, weight: (t: T) => number): T[] {
  return items
    .map((it, i) => ({ it, i, t: TIER_ORDER.indexOf(tier(it)), w: weight(it) }))
    .sort((a, b) => a.t - b.t || b.w - a.w || a.i - b.i)
    .map((x) => x.it);
}

/** Weight of a failure kind inside the 오류 tier. */
export const FAIL_WEIGHT: Record<FieldStatus, number> = { match: 0, extra: 1, diff: 2, type: 3, missing: 4 };
