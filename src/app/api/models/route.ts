import { createModelRole, listModelRoles } from "@/lib/services/models";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type ModelRoleCreate } from "@/lib/types";

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
