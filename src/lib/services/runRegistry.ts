// Keeps an evaluation run alive independently of the browser connection.
//
// The run used to execute *inside* the SSE stream, with the request's
// AbortSignal wired into the cancel check — so a refresh, a tab close, or a
// flaky network read as "cancel this run". Here the execution is owned by this
// module instead: streams attach to it and detach from it, and only the
// explicit Cancel button (which flips STATUS_CD to 'CANCELLING' in the DB) stops
// it. A reconnecting client is replayed everything it missed.

import type { RunEvent } from "@/lib/types";
import type { Emit } from "./flow";

type Listener = (e: RunEvent) => void;

export const TERMINAL_EVENTS = ["DONE", "FAILED", "CANCELLED"] as const;

export function isTerminalEvent(e: RunEvent): boolean {
  return (TERMINAL_EVENTS as readonly string[]).includes(e.event);
}

interface LiveRun {
  /** The RUNNING event, replayed first so a reattaching client knows the total. */
  running: RunEvent | null;
  /** Latest event per result row, in first-seen order. SCORE overwrites the
   * case's earlier ANSWER, so this stays bounded by case count rather than
   * growing with every event — and replaying it rebuilds the table exactly. */
  cases: Map<number, RunEvent>;
  /** Set once the run ends; replayed last so the client closes its stream. */
  terminal: RunEvent | null;
  listeners: Set<Listener>;
}

// Module scope: one map per server process, shared by every request that lands
// on it. Runs do not survive a server restart — see the orphan handling in
// flow.ts, which fails such a run rather than silently re-running its cases.
const runs = new Map<number, LiveRun>();

/** How long a finished run stays attachable, so a client that reconnects just
 * after the end still gets its terminal event instead of a dead stream. */
const KEEP_AFTER_FINISH_MS = 60_000;

export function isLive(runId: number): boolean {
  return runs.has(runId);
}

/**
 * Begin executing ``runId`` in the background. Returns false when a run is
 * already registered under that id (a second stream must attach, not re-run).
 */
export function startRun(runId: number, exec: (emit: Emit) => Promise<void>): boolean {
  if (runs.has(runId)) return false;
  const live: LiveRun = { running: null, cases: new Map(), terminal: null, listeners: new Set() };
  runs.set(runId, live);

  const emit: Emit = (e) => {
    if (e.event === "ANSWER" || e.event === "SCORE") live.cases.set(e.result.ragas_result_id, e);
    else if (e.event === "RUNNING") live.running = e;
    else live.terminal = e;
    // Copy: a listener may unsubscribe itself on the terminal event.
    for (const l of [...live.listeners]) {
      try {
        l(e);
      } catch {
        /* one bad listener must not stop the run */
      }
    }
  };

  void exec(emit)
    .catch(() => {
      /* executeRun records its own failures; nothing to add here */
    })
    .finally(() => {
      const t = setTimeout(() => runs.delete(runId), KEEP_AFTER_FINISH_MS);
      // Don't hold the process open just to expire a map entry.
      (t as unknown as { unref?: () => void }).unref?.();
    });
  return true;
}

/**
 * Attach ``listener`` to a live run, replaying everything emitted so far
 * (RUNNING → each case → terminal) before any new event. Returns an unsubscribe
 * function, or null when nothing is registered under ``runId``.
 *
 * The replay runs synchronously inside this call, so no event can slip between
 * the replay and the subscription.
 */
export function subscribe(runId: number, listener: Listener): (() => void) | null {
  const live = runs.get(runId);
  if (!live) return null;
  live.listeners.add(listener);
  if (live.running) listener(live.running);
  for (const e of live.cases.values()) listener(e);
  if (live.terminal) listener(live.terminal);
  return () => live.listeners.delete(listener);
}
