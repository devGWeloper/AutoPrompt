import { moveCases } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await jsonBody<{ case_ids?: number[]; case_type?: string }>(req);
    return ok(await moveCases(intParam(params.dataset_id, "dataset_id"), body?.case_ids, body?.case_type));
  } catch (e) {
    return errorResponse(e);
  }
}
