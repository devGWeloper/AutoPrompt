import { deleteVersion, getVersion, updateVersionPrompt } from "@/lib/services/prompts";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, noContent, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type PromptVersionEdit } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { prompt_id: string } }) {
  try {
    return ok(await getVersion(intParam(params.prompt_id, "prompt_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: { params: { prompt_id: string } }) {
  try {
    const body = await jsonBody<PromptVersionEdit>(req);
    const updated = await updateVersionPrompt(
      intParam(params.prompt_id, "prompt_id"),
      {
        system_prompt: body.system_prompt ?? "",
        user_prompt: body.user_prompt ?? "",
        model_nm: body.model_nm,
        change_summary: body.change_summary,
        change_reason: body.change_reason,
      },
      SYSTEM_USER,
    );
    return ok(updated);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { prompt_id: string } }) {
  try {
    await deleteVersion(intParam(params.prompt_id, "prompt_id"), SYSTEM_USER);
    return noContent();
  } catch (e) {
    return errorResponse(e);
  }
}
