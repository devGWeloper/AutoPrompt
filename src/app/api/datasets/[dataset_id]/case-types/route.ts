import { createDatasetCategory, listDatasetCategories } from "@/lib/services/caseTypes";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseTypeInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    return ok(await listDatasetCategories(intParam(params.dataset_id, "dataset_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await jsonBody<CaseTypeInput>(req);
    return ok(
      await createDatasetCategory(intParam(params.dataset_id, "dataset_id"), body, SYSTEM_USER),
      201,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
