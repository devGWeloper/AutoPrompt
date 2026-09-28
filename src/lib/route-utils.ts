import { NextResponse } from "next/server";
import { badRequest } from "./http";

/** Parse a JSON request body, throwing a 400 on malformed JSON. */
export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("invalid JSON body");
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, { status });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Parse a numeric path/query param, throwing 400 when not a finite integer. */
export function intParam(value: string | null | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`invalid ${name}`);
  return Math.trunc(n);
}

/** 재테스트 요청의 `case_ids` — 없으면 null(불일치 케이스로 돌린다). */
export function caseIdsField(body: unknown): number[] | null {
  const v = (body as { case_ids?: unknown } | null)?.case_ids;
  if (!Array.isArray(v)) return null;
  return v.map(Number).filter((n) => Number.isInteger(n));
}

/**
 * 본문의 `allow` — 목적에 쓸 키만 못 박을 때(path).
 *
 * 빈 배열과 없음을 가르지 않는다. 둘 다 "목록 없음" 이다 — 빈 목록을 그대로 받으면
 * 아무 키도 허용하지 않은 것이 되어 목적이 전건 비는데, 그걸 일부러 요청할 일은 없고
 * 실수로 보낼 일은 많다.
 */
export function allowField(body: unknown): string[] | null {
  return pathList((body as { allow?: unknown } | null)?.allow);
}

/** 본문의 `deny` — 목적에 쓰지 않을 키. `allow` 와 같은 규칙으로 읽는다. */
export function denyField(body: unknown): string[] | null {
  return pathList((body as { deny?: unknown } | null)?.deny);
}

function pathList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((p) => String(p ?? "").trim()).filter(Boolean);
  return out.length ? out : null;
}
