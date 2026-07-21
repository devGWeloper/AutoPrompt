import { deleteDataset, getDatasetDetail, updateDataset } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, noContent, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type DatasetUpdate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    return ok(await getDatasetDetail(intParam(params.dataset_id, "dataset_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await jsonBody<DatasetUpdate>(req);
    return ok(await updateDataset(intParam(params.dataset_id, "dataset_id"), body, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    await deleteDataset(intParam(params.dataset_id, "dataset_id"), SYSTEM_USER);
    return noContent();
  } catch (e) {
    return errorResponse(e);
  }
}
