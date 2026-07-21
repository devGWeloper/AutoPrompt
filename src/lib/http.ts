import { NextResponse } from "next/server";
import { logger } from "./logger";
import { DbNotConfiguredError } from "./db";

/** Service-layer HTTP error, mirroring FastAPI's HTTPException({status, detail}). */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export const notFound = (detail = "not found") => new ApiError(404, detail);
export const conflict = (detail: string) => new ApiError(409, detail);
export const badRequest = (detail: string) => new ApiError(400, detail);
export const badGateway = (detail: string) => new ApiError(502, detail);

/** Convert any thrown error into a JSON `{detail}` response, preserving the
 * `ApiError`/`{detail}` contract the client (`lib/api.ts`) expects. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ detail: e.detail }, { status: e.status });
  }
  if (e instanceof DbNotConfiguredError) {
    return NextResponse.json({ detail: e.message }, { status: 503 });
  }
  logger.error("unhandled route error", { err: String(e) });
  return NextResponse.json({ detail: "internal server error" }, { status: 500 });
}
