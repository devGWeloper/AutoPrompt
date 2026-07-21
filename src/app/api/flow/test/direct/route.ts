import { recordDirectRun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import type { DirectTestRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<DirectTestRequest>(req);
    const data = await recordDirectRun({
      message: body.message,
      baseUrl: body.base_url,
      authKey: body.auth_key,
      userId: body.user_id,
    });
    return ok({ response: data.response, docs: data.docs, raw: data.raw ?? "" });
  } catch (e) {
    return errorResponse(e);
  }
}
