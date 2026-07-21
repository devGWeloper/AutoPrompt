import { deleteRun, getRunDetail } from "@/lib/services/ragas";
import { errorResponse } from "@/lib/http";
import { intParam, noContent, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { ragas_run_id: string } }) {
  try {
    return ok(await getRunDetail(intParam(params.ragas_run_id, "ragas_run_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { ragas_run_id: string } }) {
  try {
    await deleteRun(intParam(params.ragas_run_id, "ragas_run_id"));
    return noContent();
  } catch (e) {
    return errorResponse(e);
  }
}
