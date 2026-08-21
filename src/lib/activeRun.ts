'use client';

// Remembers which run a panel is streaming so a page refresh can reattach to it.
//
// The run itself lives on the server (see services/runRegistry.ts) and keeps
// going while the browser is away; all the client needs to resume is the run id
// and the endpoint arguments the stream was opened with.
//
// sessionStorage, not localStorage: the record belongs to this tab. A second tab
// should not inherit — or clear — another tab's run.

export interface ActiveSingleRun {
  runId: number;
  /** 실행이 고른 등록 엔드포인트. null = config 기본값. */
  endpointId: number | null;
  baseUrl: string | null;
  scoreOn: boolean;
  nodeNm: string;
  verLabel: string;
}

export interface ActiveCompareRun {
  runIdA: number;
  runIdB: number;
  side: boolean; // endpoint mode: each side calls its own endpoint
  endpointA: number | null;
  endpointB: number | null;
  urlA: string | null;
  urlB: string | null;
  labelA: string;
  labelB: string;
  scoreOn: boolean;
}

const PREFIX = 'ptx.activeRun.';

export function saveActiveRun(slot: 'single' | 'compare', value: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + slot, JSON.stringify(value));
  } catch {
    /* private mode / quota — resuming is a convenience, never a requirement */
  }
}

export function readActiveRun<T>(slot: 'single' | 'compare'): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + slot);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearActiveRun(slot: 'single' | 'compare'): void {
  try {
    sessionStorage.removeItem(PREFIX + slot);
  } catch {
    /* ignore */
  }
}
