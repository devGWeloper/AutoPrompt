import { createModelRole, listModelRoles, updateModelRoles } from "@/lib/services/models";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type ModelRoleCreate, type ModelRoleUpdate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listModelRoles());
  } catch (e) {
    return errorResponse(e);
  }
}

/** Add a role; returns the whole list as it now stands. */
export async function POST(req: Request) {
  try {
    const body = await jsonBody<ModelRoleCreate>(req);
    return ok(await createModelRole(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Save one or more roles at once; returns the whole list as it now stands. */
export async function PUT(req: Request) {
  try {
    const body = await jsonBody<{ items?: ModelRoleUpdate[] }>(req);
    const items = Array.isArray(body?.items) ? body.items : [];
    return ok(await updateModelRoles(items, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
