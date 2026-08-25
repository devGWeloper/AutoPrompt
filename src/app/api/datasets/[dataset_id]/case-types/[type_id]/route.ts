import { deleteDatasetCategory, renameDatasetCategory } from "@/lib/services/caseTypes";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseTypeInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: { dataset_id: string; type_id: string } }) {
  try {
    const body = await jsonBody<CaseTypeInput>(req);
    return ok(
      await renameDatasetCategory(
        intParam(params.dataset_id, "dataset_id"),
        intParam(params.type_id, "type_id"),
        body,
        SYSTEM_USER,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { dataset_id: string; type_id: string } }) {
  try {
    return ok(
      await deleteDatasetCategory(
        intParam(params.dataset_id, "dataset_id"),
        intParam(params.type_id, "type_id"),
        SYSTEM_USER,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
