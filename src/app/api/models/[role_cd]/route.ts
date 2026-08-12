import { deleteModelRole } from "@/lib/services/models";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";
import { SYSTEM_USER } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Remove a role; returns the remaining list so the caller needs no second read. */
export async function DELETE(_req: Request, { params }: { params: { role_cd: string } }) {
  try {
    return ok(await deleteModelRole(decodeURIComponent(params.role_cd), SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
