'use client';

import type { RunWsMessage } from '@/types';
import { MOCK, mockConnect } from './mock';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

/** Derive the WebSocket origin from the HTTP API base (strip /api/v1, http->ws). */
export function wsBaseUrl(): string {
  const origin = API_BASE.replace(/\/api\/v1\/?$/, '');
  return origin.replace(/^http/, 'ws');
}

export interface RunWsHandlers {
  onMessage: (msg: RunWsMessage) => void;
  onError?: (ev: Event) => void;
  onClose?: (ev: CloseEvent) => void;
}

function connect(path: string, handlers: RunWsHandlers): WebSocket {
  if (MOCK) return mockConnect(path, handlers);
  const ws = new WebSocket(`${wsBaseUrl()}${path}`);
  ws.onmessage = (ev) => {
    try {
      handlers.onMessage(JSON.parse(ev.data) as RunWsMessage);
    } catch {
      // ignore non-JSON frames
    }
  };
  if (handlers.onError) ws.onerror = handlers.onError;
  if (handlers.onClose) ws.onclose = handlers.onClose;
  return ws;
}

/** Stream a single/batch/AB test run (`/ws/test-runs/{id}`). */
export function connectTestRunWs(runId: number, handlers: RunWsHandlers): WebSocket {
  return connect(`/ws/test-runs/${runId}`, handlers);
}

/** Stream a full-flow run (`/ws/flow-runs/{id}`). */
export function connectFlowRunWs(runId: number, handlers: RunWsHandlers): WebSocket {
  return connect(`/ws/flow-runs/${runId}`, handlers);
}

/** Stream a RAGAS evaluation run (`/ws/ragas-runs/{id}`). */
export function connectRagasRunWs(ragasRunId: number, handlers: RunWsHandlers): WebSocket {
  return connect(`/ws/ragas-runs/${ragasRunId}`, handlers);
}
