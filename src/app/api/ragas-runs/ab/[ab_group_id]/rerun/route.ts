import { createAbMismatchRerun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { caseIdsField, intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** Create an A/B pair over the cases either side of this comparison got 불일치 on —
 * or over `case_ids` when the body names them. */
export async function POST(req: Request, { params }: { params: { ab_group_id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    return ok(await createAbMismatchRerun(intParam(params.ab_group_id, "ab_group_id"), caseIdsField(body)), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
