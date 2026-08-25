import { deleteCaseType, updateCaseType } from "@/lib/services/caseTypes";
import { badRequest, errorResponse } from "@/lib/http";
import { jsonBody, ok } from "@/lib/route-utils";
import { SYSTEM_USER, type CaseTypeInput } from "@/lib/types";

export const dynamic = "force-dynamic";

function typeId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw badRequest("잘못된 분류 id 입니다");
  return id;
}

export async function PUT(req: Request, { params }: { params: { type_id: string } }) {
  try {
    const body = await jsonBody<CaseTypeInput>(req);
    return ok(await updateCaseType(typeId(params.type_id), body, SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { type_id: string } }) {
  try {
    return ok(await deleteCaseType(typeId(params.type_id), SYSTEM_USER));
  } catch (e) {
    return errorResponse(e);
  }
}
