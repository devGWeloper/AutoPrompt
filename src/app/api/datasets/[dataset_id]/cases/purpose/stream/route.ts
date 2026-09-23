import { fillCasePurposes } from "@/lib/services/datasets";
import { errorText } from "@/lib/http";
import { caseIdsField, intParam } from "@/lib/route-utils";
import { sseOf } from "@/lib/sse";

export const dynamic = "force-dynamic";

/** 스트림이 나르는 것. 한 덩어리가 저장될 때마다 FILLED 하나, 끝에 DONE 또는 FAILED. */
type PurposeEvent =
  | { event: "WORKING"; done: number; total: number }
  | { event: "FILLED"; items: { case_id: number; purpose: string }[] }
  | { event: "DONE"; filled: number; remaining: number }
  | { event: "FAILED"; message: string };

/**
 * 목적 채우기 — 채워지는 대로 흘려보낸다.
 *
 * 한 번에 200건까지 채울 수 있고 그중 LLM 으로 가는 몫은 서른 건씩 묶여 순서대로
 * 도는데, 예전처럼 끝에 한 번에 응답하면 그동안 화면에는 아무것도 없다. 축으로
 * 지어지는 건은 호출이 없어 즉시 나오므로, 먼저 보내 놓으면 기다리는 동안 볼 것이
 * 생긴다.
 *
 * 저장도 덩어리마다 끝난다(services/datasets). 그래서 도중에 창을 닫아도 그때까지
 * 채워진 것은 남는다 — 이 연결은 진행 상황을 보여 줄 뿐 작업을 소유하지 않는다.
 */
export async function POST(req: Request, { params }: { params: { dataset_id: string } }) {
  const body = await req.json().catch(() => null);
  const caseIds = caseIdsField(body);
  return sseOf<PurposeEvent>(async (emit) => {
    try {
      const id = intParam(params.dataset_id, "dataset_id");
      const res = await fillCasePurposes(id, caseIds, {
        onFilled: (items) => emit({ event: "FILLED", items }),
        onProgress: (done, total) => emit({ event: "WORKING", done, total }),
      });
      emit({ event: "DONE", ...res });
    } catch (e) {
      // 스트림은 이미 200 으로 열려 있어 상태 코드로 실패를 말할 수 없다. 프레임으로
      // 보낸다 — 부르는 쪽은 DONE 이 오지 않은 것으로도 알 수 있지만, 사람에게
      // 보여 줄 말은 여기에만 있다.
      emit({ event: "FAILED", message: errorText(e) });
    }
  });
}
