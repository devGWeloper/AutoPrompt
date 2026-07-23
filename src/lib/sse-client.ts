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
      if (parsed.status === 'DONE' || parsed.status === 'FAILED' || parsed.status === 'CANCELLED') {
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

/** Stream a single RAGAS run (`/api/ragas-runs/{id}/stream`). Returns an EventSource. */
export function connectRagasRunStream(ragasRunId: number, handlers: SseStreamHandlers): EventSource {
  return connect(`/api/ragas-runs/${ragasRunId}/stream`, handlers);
}

/** Legacy alias for connectRagasRunStream */
export const connectRagasRunWs = connectRagasRunStream;
