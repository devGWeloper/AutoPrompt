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
