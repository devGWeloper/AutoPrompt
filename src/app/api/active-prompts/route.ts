import { activePromptsForFlow } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await activePromptsForFlow());
  } catch (e) {
    return errorResponse(e);
  }
}
