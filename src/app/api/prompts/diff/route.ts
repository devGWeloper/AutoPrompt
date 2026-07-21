import type { NextRequest } from "next/server";
import { getVersion } from "@/lib/services/prompts";
import { diffText } from "@/lib/services/diff";
import { badRequest, errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";
import type { PromptDiffOut } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const v1 = intParam(sp.get("v1"), "v1");
    const v2 = intParam(sp.get("v2"), "v2");
    if (!v1 || !v2) throw badRequest("v1 and v2 are required");
    const a = await getVersion(v1);
    const b = await getVersion(v2);
    const out: PromptDiffOut = {
      v1_prompt_id: v1,
      v2_prompt_id: v2,
      system_prompt: diffText(a.system_prompt, b.system_prompt),
      user_prompt: diffText(a.user_prompt, b.user_prompt),
    };
    return ok(out);
  } catch (e) {
    return errorResponse(e);
  }
}
