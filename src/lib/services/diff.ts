import type { PromptDiffLine, PromptDiffSection } from "@/lib/types";

type Op = { tag: "equal" | "insert" | "delete" | "replace"; i1: number; i2: number; j1: number; j2: number };

/** LCS-based opcodes over two line arrays (equal/insert/delete/replace blocks),
 * mirroring Python difflib.SequenceMatcher.get_opcodes closely enough for the
 * prompt diff view. */
function getOpcodes(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk to produce raw equal/insert/delete steps.
  type Raw = { kind: "equal" | "insert" | "delete"; ai: number; bj: number };
  const raw: Raw[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: "equal", ai: i, bj: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: "delete", ai: i, bj: j });
      i++;
    } else {
      raw.push({ kind: "insert", ai: i, bj: j });
      j++;
    }
  }
  while (i < n) raw.push({ kind: "delete", ai: i++, bj: j });
  while (j < m) raw.push({ kind: "insert", ai: i, bj: j++ });

  // Coalesce runs, merging adjacent delete+insert into a single replace block.
  const ops: Op[] = [];
  let k = 0;
  while (k < raw.length) {
    const kind = raw[k].kind;
    if (kind === "equal") {
      const i1 = raw[k].ai;
      const j1 = raw[k].bj;
      let c = 0;
      while (k < raw.length && raw[k].kind === "equal") {
        k++;
        c++;
      }
      ops.push({ tag: "equal", i1, i2: i1 + c, j1, j2: j1 + c });
    } else {
      // Gather a maximal run of deletes and inserts (in any interleaving).
      const i1 = raw[k].ai;
      const j1 = raw[k].bj;
      let dels = 0;
      let ins = 0;
      while (k < raw.length && raw[k].kind !== "equal") {
        if (raw[k].kind === "delete") dels++;
        else ins++;
        k++;
      }
      const i2 = i1 + dels;
      const j2 = j1 + ins;
      if (dels && ins) ops.push({ tag: "replace", i1, i2, j1, j2 });
      else if (dels) ops.push({ tag: "delete", i1, i2, j1, j2 });
      else ops.push({ tag: "insert", i1, i2, j1, j2 });
    }
  }
  return ops;
}

function unifiedDiff(a: string[], b: string[]): string {
  const out: string[] = ["--- v1", "+++ v2"];
  for (const op of getOpcodes(a, b)) {
    if (op.tag === "equal") {
      for (let k = op.i1; k < op.i2; k++) out.push(` ${a[k]}`);
    } else {
      for (let k = op.i1; k < op.i2; k++) out.push(`-${a[k]}`);
      for (let k = op.j1; k < op.j2; k++) out.push(`+${b[k]}`);
    }
  }
  return out.join("\n");
}

export function diffText(a: string | null, b: string | null): PromptDiffSection {
  const aLines = (a ?? "").split("\n");
  const bLines = (b ?? "").split("\n");
  const lines: PromptDiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const op of getOpcodes(aLines, bLines)) {
    if (op.tag === "equal") {
      for (let k = 0; k < op.i2 - op.i1; k++) {
        lines.push({ tag: "equal", a_line: aLines[op.i1 + k], b_line: bLines[op.j1 + k] });
      }
    } else if (op.tag === "insert") {
      for (let k = op.j1; k < op.j2; k++) {
        lines.push({ tag: "insert", b_line: bLines[k] });
        added++;
      }
    } else if (op.tag === "delete") {
      for (let k = op.i1; k < op.i2; k++) {
        lines.push({ tag: "delete", a_line: aLines[k] });
        removed++;
      }
    } else {
      for (let k = op.i1; k < op.i2; k++) {
        lines.push({ tag: "delete", a_line: aLines[k] });
        removed++;
      }
      for (let k = op.j1; k < op.j2; k++) {
        lines.push({ tag: "insert", b_line: bLines[k] });
        added++;
      }
    }
  }

  return { added, removed, unified: unifiedDiff(aLines, bLines), lines };
}
