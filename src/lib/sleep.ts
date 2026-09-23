/**
 * `ms` 만큼 쉰다 — 실행이 취소되면 그 자리에서 끝난다.
 *
 * 취소가 설정된 간격을 다 기다린 뒤에야 느껴지면 안 되기 때문에 신호를 함께 받는다.
 * 실행 바깥에서 부르면(수동 호출) 신호가 없고, 그때는 그냥 `ms` 만큼 쉰다.
 *
 * 한 군데 모아 둔 건 쓰는 곳이 셋이라서다: 케이스 사이 간격(flow), 모델 호출 사이
 * 간격(llmClient), 그리고 트레이스 폴링(trace — 이쪽은 신호를 쓰지 않는다).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
