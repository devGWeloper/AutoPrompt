import { setResultPass } from "@/lib/services/ragas";
import { errorResponse } from "@/lib/http";
import { intParam, jsonBody, ok } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/** 케이스 한 건을 사람이 손으로 통과 처리한다 (`{ "pass": false }` 면 되돌린다).
 * 채점 결과는 그대로 두고 PASS_YN 만 세우며, 실행 단위 '정답 일치' 를 다시 낸다. */
export async function PUT(
  req: Request,
  { params }: { params: { ragas_run_id: string; result_id: string } },
) {
  try {
    const body = await jsonBody<{ pass?: boolean }>(req);
    return ok(
      await setResultPass(
        intParam(params.ragas_run_id, "ragas_run_id"),
        intParam(params.result_id, "result_id"),
        body?.pass !== false,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
