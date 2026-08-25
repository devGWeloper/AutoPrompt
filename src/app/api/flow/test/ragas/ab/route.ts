import { createFlowRagasAbRun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import type { FlowRagasAbRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<FlowRagasAbRequest>(req);
    const out = await createFlowRagasAbRun({
      datasetId: body.dataset_id,
      caseType: body.case_type ?? null,
      nodeNm: body.node_nm ?? null,
      promptIdA: body.prompt_id_a ?? null,
      promptIdB: body.prompt_id_b ?? null,
      metrics: body.metrics ?? [],
      score: body.score,
      modelsA: body.models_a ?? null,
      modelsB: body.models_b ?? null,
    });
    return ok(out);
  } catch (e) {
    return errorResponse(e);
  }
}
