import { createCases } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseBulkInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await jsonBody<CaseBulkInput>(req);
    return ok(await createCases(intParam(params.dataset_id, "dataset_id"), body?.cases, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
