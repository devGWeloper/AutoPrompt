// The key table's shape, kept out of the components that draw it.
//
// `structuredMatch` hands back a flat list of leaves — `slots.date`,
// `slots.time`, `items[0].id` — which is the right form for deciding a verdict
// and the wrong one for reading twenty of them. A payload three levels deep
// arrives as thirty sibling rows whose only mark of structure is a dotted
// prefix repeated on every line, and the eye has to re-parse that prefix once
// per row to see that six of them belong to the same object.
//
// So the flat list is put back into the tree it came from, with two rules that
// matter for reading rather than for correctness:
//
// · A chain with nothing to branch on is collapsed into one row — `a.b.c` is a
//   single line, not three rows of which two say nothing.
// · A group's own status is the worst of what is under it, so a collapsed
//   branch still admits it is hiding a failure.
//
// Nothing here decides anything. The rows are the same rows; only their order
// and indentation come from this file.

import type { FieldStatus } from "./exactMatch";

/** Anything the table can hang on a path. Both the single-run rows
 * (`FieldResult`) and the A/B pair rows satisfy it. */
export interface Pathed {
  path: string;
  segs: string[];
}

export interface TreeRow<T extends Pathed> {
  path: string;
  /** What the key column prints — the segments this row owns after path
   * compression, so `a.b.c` reads as one label and not as three rows. */
  label: string;
  depth: number;
  /** The compared key, when this row is one. A group row has none. */
  item?: T;
  children: TreeRow<T>[];
  /** Compared keys under this row, itself included. Drives the "n개" on a
   * collapsed group. */
  leaves: number;
}

interface Building<T extends Pathed> {
  seg: string;
  path: string;
  item?: T;
  kids: Map<string, Building<T>>;
}

/** `[0]` joins to its parent without a dot; a key does not. */
function joinSeg(prefix: string, seg: string): string {
  if (!prefix) return seg;
  return seg.startsWith("[") ? prefix + seg : `${prefix}.${seg}`;
}

function finish<T extends Pathed>(node: Building<T>, depth: number, label: string): TreeRow<T> {
  const kids = [...node.kids.values()];
  // A node that carries no key of its own and has exactly one child is pure
  // punctuation — merge it into the child rather than spending a row on it.
  if (!node.item && kids.length === 1) {
    return finish(kids[0], depth, joinSeg(label, kids[0].seg));
  }
  const children = kids.map((k) => finish(k, depth + 1, k.seg));
  return {
    path: node.path,
    label,
    depth,
    item: node.item,
    children,
    leaves: (node.item ? 1 : 0) + children.reduce((n, c) => n + c.leaves, 0),
  };
}

/**
 * The rows as the tree they describe, in the order they arrived — the expected
 * answer's own key order, which is what the reader wrote.
 */
export function buildFieldTree<T extends Pathed>(items: T[]): TreeRow<T>[] {
  const root: Building<T> = { seg: "", path: "", kids: new Map() };
  for (const it of items) {
    // The whole-value row (no segments) is the only key there is; it has no
    // parent to nest under.
    if (it.segs.length === 0) {
      root.item = it;
      continue;
    }
    let cur = root;
    let path = "";
    for (const seg of it.segs) {
      path = joinSeg(path, seg);
      let next = cur.kids.get(seg);
      if (!next) {
        next = { seg, path, kids: new Map() };
        cur.kids.set(seg, next);
      }
      cur = next;
    }
    cur.item = it;
  }
  if (root.item && root.kids.size === 0) {
    return [{ path: "", label: "", depth: 0, item: root.item, children: [], leaves: 1 }];
  }
  return [...root.kids.values()].map((k) => finish(k, 0, k.seg));
}

/** Depth-first order, stopping at any row the reader has collapsed. */
export function flattenTree<T extends Pathed>(rows: TreeRow<T>[], collapsed: Set<string>): TreeRow<T>[] {
  const out: TreeRow<T>[] = [];
  const visit = (r: TreeRow<T>) => {
    out.push(r);
    if (collapsed.has(r.path)) return;
    r.children.forEach(visit);
  };
  rows.forEach(visit);
  return out;
}

/** Worst status in a subtree, using `rank`'s ordering. A group row wears it so
 * a collapsed branch cannot look clean while hiding a failure. */
export function worstStatus<T extends Pathed>(
  row: TreeRow<T>,
  statusOf: (item: T) => FieldStatus,
  rank: (s: FieldStatus) => number,
): FieldStatus {
  let worst: FieldStatus = "match";
  const visit = (r: TreeRow<T>) => {
    if (r.item) {
      const s = statusOf(r.item);
      if (rank(s) > rank(worst)) worst = s;
    }
    r.children.forEach(visit);
  };
  visit(row);
  return worst;
}
