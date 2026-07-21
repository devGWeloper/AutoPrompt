import { requestCancel } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { ragas_run_id: string } }) {
  try {
    const id = intParam(params.ragas_run_id, "ragas_run_id");
    const res = await requestCancel(id);
    return ok({ status: res.status, ragas_run_id: String(id) }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
