import { setCaseGroundTruth } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** 케이스의 기대 정답만 갈아끼운다 — 실행 결과를 보고 정답지가 낡았다고 판단했을 때.
 * INPUT_CTN 의 나머지 키와 지난 실행 기록은 그대로다. */
export async function PUT(
  req: Request,
  { params }: { params: { dataset_id: string; case_id: string } },
) {
  try {
    const body = await jsonBody<{ ground_truth?: string }>(req);
    return ok(
      await setCaseGroundTruth(
        intParam(params.dataset_id, "dataset_id"),
        intParam(params.case_id, "case_id"),
        body?.ground_truth ?? "",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
