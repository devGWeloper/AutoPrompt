import { listRuns } from "@/lib/services/ragas";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listRuns());
  } catch (e) {
    return errorResponse(e);
  }
}
