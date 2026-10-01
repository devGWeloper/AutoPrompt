import { createLlmServer, listLlmServers, selectableLlmServers } from "@/lib/services/llmServers";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type LlmServerInput } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `?selectable=1` — what a model may be assigned to (active only). Without it,
 * the full list the settings page edits. Neither carries an API key: the
 * registry stores the key's *name*, never its value. */
export async function GET(req: Request) {
  try {
    const selectable = new URL(req.url).searchParams.get("selectable");
    return ok(selectable ? await selectableLlmServers() : await listLlmServers());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await jsonBody<LlmServerInput>(req);
    return ok(await createLlmServer(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
