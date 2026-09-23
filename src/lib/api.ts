'use client';

// Same-origin API (Next.js route handlers under /api). No separate backend.
const BASE = '/api';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  return handleResponse<T>(res);
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  // No Content-Type: the browser sets the multipart boundary automatically.
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  return handleResponse<T>(res);
}

/**
 * POST 하고 돌아오는 text/event-stream 의 `data:` 프레임을 하나씩 넘긴다.
 *
 * EventSource 는 GET 만 되어 본문을 실을 수 없다. 고른 케이스 목록처럼 본문으로
 * 보내야 하는 것이 있으면 이쪽을 쓴다.
 */
async function stream<T>(path: string, body: unknown, onEvent: (event: T) => void): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 스트림이 열리기도 전에 막힌 경우 — 평소의 오류로 던진다.
  if (!res.ok || !res.body) return handleResponse<void>(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // 프레임은 빈 줄로 끊긴다. 마지막 조각은 아직 덜 온 프레임이라 버퍼에 남긴다.
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as T);
      } catch {
        /* 읽을 수 없는 프레임 하나가 나머지를 끊지는 않게 */
      }
    }
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(path: string, form: FormData) => uploadFile<T>(path, form),
  stream,
};
