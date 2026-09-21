import { suggestDatasetPurpose } from "@/lib/services/datasets";
import { errorResponse } from "@/lib/http";
import { intParam, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** 데이터셋의 케이스를 보고 "어떤 목적의 테스트인가" 를 한 줄로 제안한다.
 * POST 인 건 LLM 을 실제로 부르기 때문이다 — 읽기처럼 캐시되면 곤란하다.
 * 저장은 하지 않는다: 화면이 받은 문장을 설명칸에 채우고, 사람이 고쳐 PUT 한다. */
export async function POST(_req: Request, { params }: { params: { dataset_id: string } }) {
  try {
    return ok(await suggestDatasetPurpose(intParam(params.dataset_id, "dataset_id")));
  } catch (e) {
    return errorResponse(e);
  }
}
