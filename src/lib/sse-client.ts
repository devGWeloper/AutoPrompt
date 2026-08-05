'use client';

import type { RunWsMessage } from '@/lib/types';

export interface SseStreamHandlers {
  onMessage: (msg: RunWsMessage) => void;
  onError?: (ev: Event) => void;
  onClose?: (ev: Event) => void;
}

export type RunWsHandlers = SseStreamHandlers;

function connect(path: string, handlers: SseStreamHandlers): EventSource {
  const es = new EventSource(path);
  es.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as RunWsMessage;
      handlers.onMessage(parsed);
      // Auto-close on terminal statuses
      if (parsed.event === 'DONE' || parsed.event === 'FAILED' || parsed.event === 'CANCELLED') {
        es.close();
        handlers.onClose?.(new Event('close'));
      }
    } catch {
      // ignore non-JSON frames
    }
  };
  es.onerror = (ev) => {
    handlers.onError?.(ev);
  };
  return es;
}

/** Stream a single RAGAS run (`/api/ragas-runs/{id}/stream`). Returns an EventSource.
 * ``side`` picks the configured A/B endpoint; ``baseUrl`` overrides it. */
export function connectRagasRunStream(
  ragasRunId: number,
  handlers: SseStreamHandlers,
  opts?: { baseUrl?: string | null; side?: 'a' | 'b' | null },
): EventSource {
  const params = new URLSearchParams();
  if (opts?.side) params.set('side', opts.side);
  if (opts?.baseUrl) params.set('base_url', opts.baseUrl);
  const q = params.toString();
  return connect(`/api/ragas-runs/${ragasRunId}/stream${q ? `?${q}` : ''}`, handlers);
}

/** Legacy alias for connectRagasRunStream */
export const connectRagasRunWs = connectRagasRunStream;
