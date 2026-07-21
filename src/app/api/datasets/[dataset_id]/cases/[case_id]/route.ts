import { deleteCase, updateCase } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, noContent, ok } from "@/lib/route-utils";
import type { CaseUpdate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: { dataset_id: string; case_id: string } }) {
  try {
    const body = await jsonBody<CaseUpdate>(req);
    return ok(
      await updateCase(intParam(params.dataset_id, "dataset_id"), intParam(params.case_id, "case_id"), body),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { dataset_id: string; case_id: string } }) {
  try {
    await deleteCase(intParam(params.dataset_id, "dataset_id"), intParam(params.case_id, "case_id"));
    return noContent();
  } catch (e) {
    return errorResponse(e);
  }
}
