import {
  createEndpoint,
  listEndpoints,
  maskEndpointHeaders,
  selectableEndpoints,
} from "@/lib/services/endpoints";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type EndpointInput } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `?selectable=1` — what a run may choose from (active only, config fallback).
 * Without it, the full list the settings page edits. */
export async function GET(req: Request) {
  try {
    const selectable = new URL(req.url).searchParams.get("selectable");
    return ok(selectable ? maskEndpointHeaders(await selectableEndpoints()) : await listEndpoints());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await jsonBody<EndpointInput>(req);
    return ok(await createEndpoint(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
