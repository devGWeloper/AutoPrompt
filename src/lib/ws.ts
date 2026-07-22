'use client';

import type { RunWsMessage } from '@/lib/types';

// Run progress streaming. The old backend used a WebSocket; the single Next.js
// app uses Server-Sent Events (EventSource) hitting a route handler that drives
// the whole run. The call signature is kept ("...Ws") so page code is unchanged.

export interface RunWsHandlers {
  onMessage: (msg: RunWsMessage) => void;
  onError?: (ev: Event) => void;
  onClose?: (ev: Event) => void;
}

function connect(path: string, handlers: RunWsHandlers): EventSource {
  const es = new EventSource(path);
  es.onmessage = (ev) => {
    try {
      handlers.onMessage(JSON.parse(ev.data) as RunWsMessage);
    } catch {
      // ignore non-JSON frames
    }
  };
  es.onerror = (ev) => {
    // EventSource auto-reconnects on transient errors; the caller closes the
    // stream on a terminal event (DONE/FAILED/CANCELLED) so it won't re-run.
    handlers.onError?.(ev);
  };
  return es;
}

/** Stream a single RAGAS run (`/api/ragas-runs/{id}/stream`). Returns an
 * EventSource; call `.close()` on a terminal event (same as the old WebSocket).
 * A/B comparisons open two of these (one per run) — there is no pair stream. */
export function connectRagasRunWs(ragasRunId: number, handlers: RunWsHandlers): EventSource {
  return connect(`/api/ragas-runs/${ragasRunId}/stream`, handlers);
}
