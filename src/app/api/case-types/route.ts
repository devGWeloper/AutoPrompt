import { createCaseType, listCaseTypes } from "@/lib/services/caseTypes";
import { errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseTypeInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listCaseTypes());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await jsonBody<CaseTypeInput>(req);
    return ok(await createCaseType(body, SYSTEM_USER), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
