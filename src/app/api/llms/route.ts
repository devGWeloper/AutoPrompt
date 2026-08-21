import { createLlmModel, listLlmModels } from "@/lib/services/llms";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type LlmModelInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listLlmModels());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await jsonBody<LlmModelInput>(req);
    return ok(await createLlmModel(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
