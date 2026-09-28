import type { AxisKind } from "./purposeAxes";

// 목적에 쓸 키를 손으로 정하는 자리.
//
// 축 분석은 정답지의 모든 키를 후보로 본다. 갈래 수와 변별력으로 걸러도 우연히 갈린
// 키가 남아서, 목적에 주문번호나 응답버전 같은 것이 섞인다. 세기로는 멀쩡한 축이라
// 규칙으로는 가려낼 수 없다.
//
// 그 판단을 여기로 옮긴다. 걸러 낸 키는 후보에서 지워지므로 LLM 이 고를 수가 없다 —
// 프롬프트로 부탁하는 것이 아니라 재료에서 뺀다.
//
// 둘 다 비워 두면 아무것도 달라지지 않는다. 지금까지처럼 모든 키가 후보다.

/**
 * 목적에 쓰지 않을 키. **평소에 쓰는 쪽이 이것이다.**
 *
 * ```ts
 * const PURPOSE_DENY = [
 *   "ord",
 *   "trace_id",
 *   "ver",
 *   "timestamp",
 * ];
 * ```
 *
 * 규칙이 이미 대부분 걸러 놓아서 새는 것은 몇 개뿐이다. 목적을 한 번 채워 보고 거슬리는
 * 키가 보이면 그때 여기 적으면 된다 — 미리 다 생각해 둘 필요가 없다.
 *
 * 열려 있다는 것이 이 목록의 값이다. 데이터셋이 바뀌어 키가 달라져도 목적은 그대로
 * 나오고, 새로 거슬리는 것만 보태면 된다.
 */
const PURPOSE_DENY: string[] = [
  // 여기에 적는다.
  "MAIN_EQP_ID", "CHAMB_RAW_ID", "SOURCE_EQP_ID",
  "OPER_ID", "LOT_CD", "Factory", "FAC_ID", "REQUESTER",
  "api"
];

/**
 * 목적에 쓸 키 — 이것만 쓰겠다고 못 박을 때.
 *
 * ```ts
 * const PURPOSE_ALLOW = [
 *   "result",
 *   "status",
 * ];
 * ```
 *
 * 적으면 나머지는 전부 막힌다. 그래서 **데이터셋마다 키가 다르면 쓰기 어렵다** — 여기
 * 적은 키가 없는 데이터셋은 목적이 전건 빈다. 이 목록은 하나뿐이고 데이터셋별로 갈리지
 * 않는다.
 *
 * 키가 정해져 있고 목적의 모양을 딱 고정하고 싶을 때만 쓴다. 평소에는 위쪽(`PURPOSE_DENY`)
 * 이 맞다.
 *
 * 둘을 같이 적으면 여기서 좁힌 다음 `PURPOSE_DENY` 로 뺀다.
 */
const PURPOSE_ALLOW: string[] = [
  // 비워 둔다.
];

// 정답지가 중첩되어 있으면 `cancel.type` 처럼 점으로 잇는다. 배열은 `items[].id` —
// 자리 번호를 적지 않으면 몇 번째든 걸린다. 키 하나를 적으면 거기서 뽑은 축(부호·길이·
// 유무)도 같이 걸린다.

/** 적힌 목록. 비어 있으면 null — 후보를 좁히지 않는다. */
export function allowedKeys(): string[] | null {
  return PURPOSE_ALLOW.length ? PURPOSE_ALLOW : null;
}

/** 제외할 목록. 비어 있으면 null. */
export function deniedKeys(): string[] | null {
  return PURPOSE_DENY.length ? PURPOSE_DENY : null;
}

/**
 * 쓰지 않을 파생 축의 종류.
 *
 * 정답지에 적힌 값(원값) 말고도, 거기서 뽑아낸 축이 있다. 값이 건마다 달라 원값으로는
 * 축이 못 되는 키를 살리려고 만든 것이다:
 *
 *   present  `amount 유무`      그 키가 정답지에 있는가       있음 / 없음
 *   blank    `amount 값 유무`   키는 있는데 값이 비었는가     있음 / 없음
 *   length   `items 길이`       배열이 몇 개인가              0 / 1 / 2 …
 *   sign     `amount 부호`      숫자가 0 이냐 아니냐           양수 / 0 / 음수
 *   type     `code 타입`        값의 자료형                   string / number
 *
 * 맞는 말이긴 한데 목적으로 읽으면 무엇을 확인하려는 건인지 잘 안 들어온다. 특히
 * 유무 둘이 그렇다 — 그래서 기본으로 꺼 뒀다.
 *
 * 배열을 자주 쓰면 `length` 는 켜 두는 편이 낫다. `items 길이=0` 은 빈 결과를 확인하는
 * 건이라는 뜻이라 목적으로 읽힌다. 비우면 다섯 가지가 전부 켜진다.
 */
const PURPOSE_SKIP_KINDS: AxisKind[] = ["present", "blank"];

/** 끌 축 종류. 비어 있으면 null — 다 쓴다. */
export function skippedKinds(): AxisKind[] | null {
  return PURPOSE_SKIP_KINDS.length ? PURPOSE_SKIP_KINDS : null;
}

/**
 * 값이 채워진 키를 **전부** 목적에 늘어놓는다.
 *
 * 끄면(=false) 형제와 견줘 갈리는 지점 한두 개만 골라 쓴다. 목록에서 훑는 표지로는 그게
 * 맞지만, 정답지가 평평하고 위 제외 목록으로 식별자를 이미 걷어 냈다면 남은 키는 전부
 * 그 건이 확인하려는 조건이다 — 그중 하나만 고르면 오히려 정보를 버린다.
 *
 *   꺼짐:  type='FULL', result='OK' 확인
 *   켜짐:  type='FULL', result='OK', amount='30000', step='READY' 확인
 *
 * 켜면 LLM 을 부르지 않는다. 고를 것이 없으니 고르게 할 일도 없다 — 목적 채우기가
 * 즉시 끝나고 호출도 대기(`agent.caseDelaySec`)도 없다. 정답지가 JSON 이 아닌 건만
 * 예전처럼 LLM 이 쓴다.
 *
 * 빈 값(null, 빈 문자열, [], {})인 키는 빠진다. 파생 축(부호·길이·유무)도 안 쓴다 —
 * 원값만 늘어놓는 자리다.
 */
const PURPOSE_EVERY_KEY = true;

/**
 * 목적 한 줄의 길이 상한.
 *
 * 전부 늘어놓으면 줄이 길어진다. 60은 목록에서 한 줄로 읽히는 길이라 그대로 두면 뒤가
 * 잘린다. 넘치면 `…` 로 잘리므로, 키가 많으면 올린다.
 */
const PURPOSE_LINE_MAX = PURPOSE_EVERY_KEY ? 200 : 60;

/** 전부 늘어놓는 모드인가. */
export function everyKey(): boolean {
  return PURPOSE_EVERY_KEY;
}

/** 목적 한 줄의 길이 상한. */
export function lineMax(): number {
  return PURPOSE_LINE_MAX;
}
