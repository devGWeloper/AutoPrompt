import { getCurrentFlow } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await getCurrentFlow());
  } catch (e) {
    return errorResponse(e);
  }
}
