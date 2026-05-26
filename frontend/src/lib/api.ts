'use client';

import { MOCK, mockRequest } from './mock';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

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
  if (MOCK) {
    const method = (init.method as string) ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    return mockRequest<T>(method, path, body);
  }
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
  if (MOCK) return mockRequest<T>('POST', path, {});
  // No Content-Type: the browser sets the multipart boundary automatically.
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  return handleResponse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => uploadFile<T>(path, form),
};
