import { importCsv } from "@/lib/services/datasets";
import { badRequest, errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";
import { SYSTEM_USER } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("multipart form must include a 'file' field");
    const text = await file.text();
    return ok(await importCsv(intParam(params.dataset_id, "dataset_id"), text, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
