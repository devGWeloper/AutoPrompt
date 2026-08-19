import { recordDirectAbRun, type DirectRunResult } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import type { DirectAbRequest, DirectAbSide } from "@/lib/types";

export const dynamic = "force-dynamic";

const side = (s: DirectAbSide | undefined) => ({
  promptId: s?.prompt_id ?? null,
  baseUrl: s?.base_url ?? null,
  authKey: s?.auth_key ?? null,
  userId: s?.user_id ?? null,
  models: s?.models ?? null,
});

const out = (r: DirectRunResult) => ({
  response: r.response,
  docs: r.docs,
  raw: r.raw ?? "",
  scores: r.scores,
  score_error: r.score_error,
  elapsed_ms: r.elapsed_ms,
});

export async function POST(req: Request) {
  try {
    const body = await jsonBody<DirectAbRequest>(req);
    const { a, b } = await recordDirectAbRun({
      message: body.message,
      score: body.score,
      metrics: body.metrics,
      expectedOutput: body.expected_output,
      a: side(body.a),
      b: side(body.b),
    });
    return ok({ a: out(a), b: out(b) });
  } catch (e) {
    return errorResponse(e);
  }
}
