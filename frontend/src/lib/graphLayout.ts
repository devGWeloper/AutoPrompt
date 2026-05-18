import type { Graph } from '@/types';

export const LEVEL_GAP = 140;
export const COL_GAP = 240;

/** LangGraph-style vertical layout: rank nodes top→bottom by longest path from roots. */
export function layoutVertical(g: Graph): Record<number, { x: number; y: number }> {
  const adj = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (const n of g.nodes) {
    adj.set(n.node_id, []);
    indeg.set(n.node_id, 0);
  }
  for (const e of g.edges) {
    if (!adj.has(e.source_node_id) || !adj.has(e.target_node_id)) continue;
    adj.get(e.source_node_id)!.push(e.target_node_id);
    indeg.set(e.target_node_id, (indeg.get(e.target_node_id) ?? 0) + 1);
  }
  const level = new Map<number, number>();
  const queue: number[] = [];
  for (const n of g.nodes) {
    if ((indeg.get(n.node_id) ?? 0) === 0) {
      level.set(n.node_id, 0);
      queue.push(n.node_id);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const cl = level.get(cur) ?? 0;
    for (const nxt of adj.get(cur) ?? []) {
      if ((level.get(nxt) ?? -1) < cl + 1) level.set(nxt, cl + 1);
      queue.push(nxt);
    }
  }
  const perLevel = new Map<number, number>();
  const pos: Record<number, { x: number; y: number }> = {};
  for (const n of g.nodes) {
    const lv = level.get(n.node_id) ?? 0;
    const idx = perLevel.get(lv) ?? 0;
    perLevel.set(lv, idx + 1);
    pos[n.node_id] = { x: idx * COL_GAP, y: lv * LEVEL_GAP };
  }
  return pos;
}
