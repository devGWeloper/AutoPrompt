import { fillCasePurposes, previewCaseAxes } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { caseIdsField, intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** 폴더마다 어떤 축이 잡히고 목적이 어떤 모양으로 나올지. GET 인 건 아무것도 쓰지
 * 않고 LLM 도 부르지 않기 때문이다 — 채우기 전에 기준을 보는 자리다. */
export async function GET(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    return ok(await previewCaseAxes(intParam(params.dataset_id, "dataset_id")));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 목적이 비어 있는 케이스를 한 줄씩 채운다 — 정답지가 JSON 이면 축으로, 아니면
 * LLM 으로. 본문의 `case_ids` 는 "고른 것만" — 없으면 이 데이터셋에서 비어 있는 것
 * 전부가 대상이다. */
export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    return ok(await fillCasePurposes(intParam(params.dataset_id, "dataset_id"), caseIdsField(body)));
  } catch (e) {
    return errorResponse(e);
  }
}
