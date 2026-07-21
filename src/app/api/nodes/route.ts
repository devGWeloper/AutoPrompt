import { createNode } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type NodeCreate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<NodeCreate>(req);
    return ok(await createNode(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
