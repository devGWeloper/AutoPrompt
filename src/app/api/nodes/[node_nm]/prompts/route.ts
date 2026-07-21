import { createPrompt, listVersions } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type PromptVersionCreate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { node_nm: string } }) {
  try {
    return ok(await listVersions(decodeURIComponent(params.node_nm)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: { node_nm: string } }) {
  try {
    const body = await jsonBody<PromptVersionCreate>(req);
    return ok(await createPrompt(decodeURIComponent(params.node_nm), body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
