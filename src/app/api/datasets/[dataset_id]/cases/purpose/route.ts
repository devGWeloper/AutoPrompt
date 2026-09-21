import { fillCasePurposes } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { caseIdsField, intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** 목적이 비어 있는 케이스에 LLM 이 한 줄씩 채운다. 본문의 `case_ids` 는 "고른
 * 것만" — 없으면 이 데이터셋에서 비어 있는 것 전부가 대상이다. */
export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    return ok(await fillCasePurposes(intParam(params.dataset_id, "dataset_id"), caseIdsField(body)));
  } catch (e) {
    return errorResponse(e);
  }
}
