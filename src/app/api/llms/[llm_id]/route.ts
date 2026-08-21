import { deleteLlmModel, updateLlmModel } from "@/lib/services/llms";
import { badRequest, errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type LlmModelInput } from "@/lib/types";

export const dynamic = "force-dynamic";

function llmId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw badRequest("잘못된 모델 id 입니다");
  return id;
}

export async function PUT(req: Request, { params }: { params: { llm_id: string } }) {
  try {
    const body = await jsonBody<LlmModelInput>(req);
    return ok(await updateLlmModel(llmId(params.llm_id), body, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { llm_id: string } }) {
  try {
    return ok(await deleteLlmModel(llmId(params.llm_id), SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
