import { createFlowDataset, listFlowDatasets } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { SYSTEM_USER, type DatasetCreate } from "@/lib/types";
import { jsonBody, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listFlowDatasets());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await jsonBody<DatasetCreate>(req);
    return ok(await createFlowDataset(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
