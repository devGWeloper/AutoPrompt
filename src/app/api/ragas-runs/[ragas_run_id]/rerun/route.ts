import { createMismatchRerun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** Create a run over the 불일치 cases of this run. It starts when its stream opens. */
export async function POST(_req: Request, { params }: { params: { ragas_run_id: string } }) {
  try {
    return ok(await createMismatchRerun(intParam(params.ragas_run_id, "ragas_run_id")), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
