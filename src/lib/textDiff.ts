// Word-level diff for the result screens: given the answer that was scored and
// the expected answer, which parts of each are not in the other.
//
// The rule it has to agree with is `exactMatch` — whitespace never decides O/X
// there, so whitespace is never highlighted here either. A run that scored O
// therefore shows no highlights at all, and any highlight is a real reason the
// case failed. Diffing is display-only: the verdict always comes from the score.

export interface DiffSeg {
  text: string;
  /** false = this run of text has no counterpart on the other side. */
  same: boolean;
}

export interface DiffPair {
  left: DiffSeg[];
  right: DiffSeg[];
  /** Both sides carry nothing but matched tokens. */
  identical: boolean;
}

/**
 * Words, punctuation, and whitespace as separate tokens. Punctuation is split
 * off so a JSON value that changed does not drag its braces and quotes into the
 * highlight with it.
 */
const WORD_RE = /\s+|[A-Za-z0-9_À-ɏ가-힣.+-]+|[^\s]/gu;

/** Whole lines, newline attached. The fallback unit for texts with too many
 * words to align one by one. */
const LINE_RE = /[^\n]*\n|[^\n]+/g;

const isSpace = (t: string) => /^\s+$/.test(t);

/** What decides whether two tokens are the same. Whitespace inside a line is
 * collapsed for the same reason the verdict collapses it. */
const key = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Beyond this the O(n·m) table costs more than the highlight is worth; the word
 * pass hands over to the line pass, and the line pass gives up on precision. */
const MAX_CELLS = 4_000_000;

/** Runs of tokens with the same verdict, merged so the DOM holds a handful of
 * spans instead of one per word. */
function merge(tokens: string[], same: boolean[]): DiffSeg[] {
  const out: DiffSeg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const last = out[out.length - 1];
    if (last && last.same === same[i]) last.text += tokens[i];
    else out.push({ text: tokens[i], same: same[i] });
  }
  return out;
}

interface Aligned {
  sameA: boolean[];
  sameB: boolean[];
}

/**
 * Which tokens of each side the other side also has, by longest common
 * subsequence over the significant (non-whitespace) tokens.
 *
 * Null when the table would be too large — the caller then falls back to a
 * coarser unit rather than spending seconds on an alignment nobody will read
 * word by word anyway.
 */
function align(A: string[], B: string[]): Aligned | null {
  const sameA = new Array<boolean>(A.length).fill(true);
  const sameB = new Array<boolean>(B.length).fill(true);

  // Keys once, not per table cell — the inner loop runs n·m times and a regex
  // there costs more than the whole alignment.
  const ka = A.map(key);
  const kb = B.map(key);

  // Significant tokens only; whitespace rides along as always-matched.
  const ia: number[] = [];
  const ib: number[] = [];
  A.forEach((t, i) => { if (!isSpace(t)) ia.push(i); });
  B.forEach((t, i) => { if (!isSpace(t)) ib.push(i); });

  // Common head and tail first — an answer that differs in one clause shares
  // almost everything, and this takes the table down to that clause.
  let head = 0;
  while (head < ia.length && head < ib.length && ka[ia[head]] === kb[ib[head]]) head++;
  let tail = 0;
  while (
    tail < ia.length - head &&
    tail < ib.length - head &&
    ka[ia[ia.length - 1 - tail]] === kb[ib[ib.length - 1 - tail]]
  ) {
    tail++;
  }

  const midA = ia.slice(head, ia.length - tail);
  const midB = ib.slice(head, ib.length - tail);
  const n = midA.length;
  const m = midB.length;

  // One side owns the whole middle: nothing to align inside it.
  if (n === 0 || m === 0) {
    for (const i of midA) sameA[i] = false;
    for (const i of midB) sameB[i] = false;
    return { sameA, sameB };
  }
  if (n * m > MAX_CELLS) return null;

  const w = m + 1;
  const rowKeys = midA.map((i) => ka[i]);
  const colKeys = midB.map((j) => kb[j]);
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const a = rowKeys[i];
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a === colKeys[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (rowKeys[i] === colKeys[j]) {
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      sameA[midA[i]] = false;
      i++;
    } else {
      sameB[midB[j]] = false;
      j++;
    }
  }
  for (; i < n; i++) sameA[midA[i]] = false;
  for (; j < m; j++) sameB[midB[j]] = false;

  return { sameA, sameB };
}

/**
 * The two texts, each split into matched and unmatched runs.
 *
 * Words first. Two long texts that share little would need a table too big to
 * be worth building, so those fall back to whole lines — coarser, but it still
 * points at where the two answers part ways, which is the whole job.
 */
export function diffWords(left: string, right: string): DiffPair {
  for (const re of [WORD_RE, LINE_RE]) {
    const A = left.match(re) ?? [];
    const B = right.match(re) ?? [];
    const hit = align(A, B);
    if (!hit) continue;
    const identical = hit.sameA.every(Boolean) && hit.sameB.every(Boolean);
    return { left: merge(A, hit.sameA), right: merge(B, hit.sameB), identical };
  }
  // Too long to align even by line: say that everything differs rather than
  // implying, with an unmarked pane, that the two texts are the same.
  return {
    left: [{ text: left, same: false }],
    right: [{ text: right, same: false }],
    identical: false,
  };
}
