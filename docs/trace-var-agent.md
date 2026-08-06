# 중간 변수 채점 — 에이전트 쪽 연동

노드에 따라 최종 답변이 아니라 **호출 도중의 변수**가 채점 대상이다. 슬롯 파싱 노드의
`parsed`(dict)가 그렇다. 응답에 실을 수 없으므로 에이전트가 공유 Oracle DB 에 남기고
PTX 가 읽어서 정답지와 비교한다.

## 계약

- **상관키는 `TRACE_ID`.** PTX 가 발급해 요청의 `session_system_prompt`(문자열화된 JSON)에
  `TRACE_ID` 키로 실어 보낸다. 이미 보내고 있으므로 요청 형식은 안 바뀐다.
- **에이전트는 `PTX_TRACE_HIS` 에 INSERT 만 한다.** 다른 PTX 테이블은 건드리지 않는다.
- **행이 있으면 PTX 가 그 값을 채점하고, 없으면 최종 답변을 채점한다.** 노드 매핑도
  케이스 설정도 없다 — 기록하는 노드만 기록하면 된다.
- **`TRACE_ID` 가 비어 있으면 아무것도 쓰지 않는다.** 운영 트래픽에는 이 값이 없으므로
  평가 호출만 기록된다.

## 붙이는 코드

`parsed` 가 만들어지는 자리에 한 줄:

```python
def node2(...):
    ...
    parsed = json.loads(llm_out)                 # 기존 코드
    trace_write(trace_id, "parsed", parsed)      # ← 추가되는 유일한 줄
    ...
```

`trace_id` 는 진입점에서 꺼내 노드까지 내려준 값이다:

```python
ctx = json.loads(req.session_system_prompt or "{}")
trace_id = ctx.get("TRACE_ID")
```

writer:

```python
import json
import oracledb
from app.db import trace_pool     # PTX_PROMPT_HIS 로더가 쓰는 DSN 그대로

_MAX = 200_000                    # CLOB 상한 — 값이 커도 호출을 망가뜨리지 않게

def trace_write(trace_id: str | None, var_nm: str, value) -> None:
    if not trace_id:              # 운영 트래픽은 여기서 끝
        return
    try:
        ctn = json.dumps(value, ensure_ascii=False, default=str)[:_MAX]
        with trace_pool.acquire() as conn:                 # 본 트랜잭션과 분리된 커넥션
            conn.cursor().execute(
                "INSERT INTO PTX_TRACE_HIS (TRACE_ID, VAR_NM, VAR_CTN) VALUES (:t, :v, :c)",
                t=trace_id, v=var_nm, c=ctn,
            )
            conn.commit()                                   # 즉시 커밋해야 PTX 가 읽는다
    except Exception:
        logger.warning("trace write failed", exc_info=True) # 절대 재던지지 않는다
```

지켜야 할 세 가지:

1. **별도 커넥션 + 즉시 커밋.** 본 트랜잭션에 물리면 응답이 끝날 때까지 PTX 가 못 읽는다.
2. **예외를 삼킨다.** 트레이스 기록 실패가 실제 호출을 죽이면 안 된다.
3. **`json.dumps(default=str)` 주의.** `parsed` 가 순수 dict 가 아니라 Pydantic 모델이나
   `datetime`/`Decimal` 을 품고 있으면 문자열로 바뀌어 정답지와 형태가 달라진다. 순수
   dict 가 아니면 `model_dump(mode="json")` 등으로 명시적으로 평탄화한다.

## 권한 / 정리

```sql
GRANT INSERT ON PTX_TRACE_HIS TO <agent_user>;   -- PTX 스키마와 계정이 다를 때만
```

행은 계속 쌓이기만 하므로 보존기간을 정해 주기적으로 지운다. 실행 기록에는
`PTX_RUN_DET.TRACE_CTN` 스냅샷이 남으므로 지워도 과거 결과는 그대로다.

```sql
DELETE FROM PTX_TRACE_HIS WHERE CRT_TM < SYSTIMESTAMP - INTERVAL '30' DAY;
```

## 채점 규칙 (PTX 쪽 — 정답지 작성에 필요)

- `parsed` 와 정답지 양쪽 다 JSON 이면 **키 순서·들여쓰기 무시 구조 비교**다.
- **완전 일치**다. 키가 하나라도 더 있거나 빠지면 불일치 — 안 채워야 할 슬롯을 채우는
  오류(환각)를 잡기 위한 선택이다. 빈 슬롯도 `""` 까지 정확히 적어야 한다.
- `""` / `null` / 키 없음은 **서로 다르다**. 숫자 `22` 와 문자열 `"22"` 도 다르다.
  파서가 이걸 일관되게 내지 않으면 테스트가 이유 없이 깜빡인다.
- 정답지는 손으로 쓰지 말고 **한 번 실행한 뒤 결과 화면의 값을 복사해서** 만드는 게 낫다.
  (실행 결과 상세에 `parsed` 원본과 복사 버튼이 있다.)
- 최종 답변용 `body` 언랩은 중간 변수 비교에는 적용되지 않는다 — `parsed` 안의 `body`
  키는 껍데기가 아니라 실제 데이터이기 때문이다.

## 호출이 실패한 경우

노드2가 `trace_write` 를 지나고 나서 뒤에서 터져도 값은 이미 커밋돼 있다. PTX 는 이 경우
**호출 에러여도 채점한다** — "답변 생성은 실패했지만 파싱은 정상이었다"를 잡는 게 이
테스트의 목적이기 때문이다. 반대로 `trace_write` 전에 죽어서 행이 없으면 최종 답변으로
채점되고, 결과에 `트레이스 없음 — 최종 답변으로 채점됨` 이 남는다.
