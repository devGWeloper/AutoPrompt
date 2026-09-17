import { createMismatchRerun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { caseIdsField, intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** Create a run over the 불일치 cases of this run — or over `case_ids` when the
 * body names them. It starts when its stream opens. */
export async function POST(req: Request, { params }: { params: { ragas_run_id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    return ok(await createMismatchRerun(intParam(params.ragas_run_id, "ragas_run_id"), caseIdsField(body)), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
