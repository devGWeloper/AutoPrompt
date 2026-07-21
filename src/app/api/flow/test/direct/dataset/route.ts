import { runDirectDataset } from "@/lib/services/flow";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import type { DirectDatasetRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await jsonBody<DirectDatasetRequest>(req);
    const results = await runDirectDataset({
      datasetId: body.dataset_id,
      baseUrl: body.base_url,
      authKey: body.auth_key,
      userId: body.user_id,
    });
    return ok({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
