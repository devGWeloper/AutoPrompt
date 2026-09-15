import { createAbMismatchRerun } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** Create an A/B pair over the cases either side of this comparison got 불일치 on. */
export async function POST(_req: Request, { params }: { params: { ab_group_id: string } }) {
  try {
    return ok(await createAbMismatchRerun(intParam(params.ab_group_id, "ab_group_id")), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
