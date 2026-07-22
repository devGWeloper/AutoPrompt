import { createFlowRagasRun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import type { FlowRagasRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<FlowRagasRequest>(req);
    const run = await createFlowRagasRun({
      datasetId: body.dataset_id,
      metrics: body.metrics ?? [],
      nodeNm: body.node_nm,
      promptId: body.prompt_id,
      score: body.score,
    });
    return ok(run);
  } catch (e) {
    return errorResponse(e);
  }
}
