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
      promptId: body.prompt_id,
      baseUrl: body.base_url,
      authKey: body.auth_key,
      userId: body.user_id,
      score: body.score,
      metrics: body.metrics,
      expectedOutput: body.expected_output,
    });
    // score_error travels with the answer: the call succeeded, so dropping it
    // here would leave the UI with a blank score block and no reason for it.
    return ok({
      response: data.response,
      docs: data.docs,
      raw: data.raw ?? "",
      scores: data.scores,
      score_error: data.score_error,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
