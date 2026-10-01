import { getLlmKeyNames } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** The names under config.yml `llmKeys` — what a server's key may be set to.
 * Names only: the values never leave the server except in the request to the
 * agent. */
export async function GET() {
  try {
    return ok(getLlmKeyNames());
  } catch (e) {
    return errorResponse(e);
  }
}
