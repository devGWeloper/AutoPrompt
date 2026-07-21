import { activePromptForNode } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { node_nm: string } }) {
  try {
    return ok(await activePromptForNode(decodeURIComponent(params.node_nm)));
  } catch (e) {
    return errorResponse(e);
  }
}
