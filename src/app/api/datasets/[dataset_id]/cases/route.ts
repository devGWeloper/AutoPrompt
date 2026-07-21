import { createCase, listCases } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseCreate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    return ok(await listCases(intParam(params.dataset_id, "dataset_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await jsonBody<CaseCreate>(req);
    return ok(await createCase(intParam(params.dataset_id, "dataset_id"), body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
