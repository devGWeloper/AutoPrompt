# LLM role 별 모델 — 에이전트 쪽 연동 가이드

에이전트 config 는 LLM 을 role 로 나눠 정의한다 (`llm` / `vlm` / `light_llm` / `judge_llm`).
모델을 바꿔가며 테스트할 때마다 그 config 를 손으로 고치는 대신, **PTX 실행 화면에서 지정하고
에이전트가 호출 단위로 읽어 간다.**

```
PTX Single·Compare 탭의 '모델' 칸        ← 실행마다 지정. 고른 모델이 등록된
                                          LLM 서버의 주소가 같이 실려 나간다
              │  PTX 가 호출 직전에 적음
              ▼
        PTX_CALL_MAS (TRACE_ID, MODEL_CTN)
              ▲
    에이전트가 TRACE_ID 로 SELECT — 그 호출에만 적용
```

`PTX_MODEL_MAS`(role 목록) 와 `PTX_LLMSVR_MAS`(LLM 서버 목록) 는 PTX 전용 설정 테이블이라
**에이전트는 볼 필요가 없다.** 고른 모델의 주소는 PTX 가 풀어서 `MODEL_CTN` 에 실어 보내므로,
에이전트가 읽는 건 여전히 `PTX_CALL_MAS` 하나이고 **GRANT 는 늘어나지 않는다.**

`TRACE_ID` 는 PTX 가 발급해 `session_system_prompt` 로 **원래부터 보내던 값**이다
(`PTX_TRACE_HIS` 상관키). **요청 형식은 바뀌지 않는다.**

`PTX_CALL_MAS` 는 `PTX_TRACE_HIS` 와 방향만 반대인 대칭 테이블이다.

| 테이블 | 쓰는 쪽 | 읽는 쪽 | 상관키 |
|---|---|---|---|
| `PTX_TRACE_HIS` | 에이전트 | PTX | `TRACE_ID` |
| `PTX_CALL_MAS` | PTX | 에이전트 | `TRACE_ID` |

PTX 쪽은 끝났다. 이 문서는 **에이전트(`C:\work\aiai`) 쪽에서 할 일**을 적은 것이다.
경로·줄번호는 이 저장소가 참조한 체크아웃 기준이라, 실 환경과 다르면 구조만 가져다 쓰면 된다.

---

## 1. 계약

**규칙은 하나다 — 행이 없으면 지금까지와 똑같이 동작한다.**

| 호출 | `PTX_CALL_MAS` 행 | 결과 |
|---|---|---|
| 운영 트래픽 | `TRACE_ID` 자체가 없음 | config 그대로 |
| PTX 실행 — 모델 칸에 값이 있음 | 있음 | 지정된 모델 |
| PTX 실행 — 모델 칸이 전부 비어 있음 | 없음 | config 그대로 |

A/B 는 사이드마다 `TRACE_ID` 가 다르고 PTX 가 사이드별로 행을 남기므로, A 와 B 에 서로 다른
모델이 자연히 갈린다. **에이전트는 사이드를 알 필요가 없다** — `TRACE_ID` 로 조회할 뿐이다.

`MODEL_CTN` 형식:

```json
{
  "LLM": {
    "model": "Qwen3-235B-A22B-Instruct-2507-AWQ",
    "temperature": 0.3,
    "server": "vllm-a",
    "base_url": "http://10.0.0.5:8000/v1",
    "api_key_ref": "VLLM_A_KEY"
  },
  "VLM": { "model": "qwen2-vl-72b" }
}
```

- **키는 role 이름** — `LLMModel` enum 의 **멤버 이름(`.name`)** 과 글자까지 같다 (§2).
- **지정 없는 role 은 아예 빠진다.** 그 role 은 config 값 그대로 쓴다.
- 각 항목은 **따로따로 없을 수 있다.** 없는 항목은 건드리지 않는다.
- `base_url` 은 그 모델이 떠 있는 서버다 (PTX 설정의 **LLM 서버** 목록).
  모델마다 서빙 주소가 다르기 때문에 모델명만으로는 부족하다 — 이게 없으면
  에이전트는 config 의 주소 한 곳에 없는 모델을 달라고 하게 된다.
  없으면 지금까지처럼 config 의 `base_url` 을 쓴다.
- `server` 는 그 주소의 등록 이름이다. **로그·기록용**이고 호출에는 안 쓴다.
- `api_key_ref` 는 API 키의 **이름**이다 — 키 값이 아니다 (§1-1).

**에이전트가 지켜야 하는 것**

- **읽기만 한다.** `GRANT SELECT ON PTX_CALL_MAS TO <agent_user>`.
- **그 호출에만 적용한다.** 전역 설정을 바꾸지 않는다 — 동시에 들어온 다른 요청이
  영향받으면 A/B 가 무의미해진다.
- **모르는 role 은 무시한다.**
- **조회 실패는 무시한다.** 경고 로그만 남기고 config 로 진행한다.
- **키 값은 DB 에서 오지 않는다.** 요청 헤더 `X-PTX-LLM-KEYS` 로 온다 (§1-1).

### 1-1. API 키는 DB 가 아니라 요청 헤더로 온다

키는 **PTX 의 `config.yml` `llmKeys`** 에 있다. 에이전트 쪽에 키를 따로 둘 필요가 없다.

```
PTX config.yml                     PTX_LLMSVR_MAS.KEY_REF     MODEL_CTN.api_key_ref
llmKeys:                           = "VLLM_A_KEY"  (이름만)    = "VLLM_A_KEY"  (이름만)
  VLLM_A_KEY: "sk-..."  ─┐
                         │ PTX 가 호출 직전에 config 에서 꺼내
                         ▼
POST <agent chat endpoint>
X-PTX-LLM-KEYS: {"LLM": "sk-..."}    ← role → 키 값. 이 요청에만 실린다
```

- 헤더 값은 JSON 이고 **키는 role 이름**이다 — `MODEL_CTN` 과 같은 키라서 role 의
  override 와 그 role 의 키를 바로 짝지을 수 있다.
- **헤더가 없거나 그 role 이 없으면** 지금 쓰던 config 의 `api_key` 를 쓴다.
  운영 트래픽에는 이 헤더가 절대 실리지 않는다.
- `MODEL_CTN.api_key_ref` 는 기록용 이름이다. 에이전트는 이걸로 키를 찾지 않는다.

키를 DB 에 넣지 않는 건 정책이기도 하지만 구조 때문이기도 하다 — 실행은
`MODEL_CTN` 을 `PTX_RUN_MAS` 에 스냅샷으로 박고, 그 문자열이 감사로그와 CSV
내보내기로 그대로 복제된다. 키가 거기 있으면 세 곳에 평문으로 남는다.

**에이전트가 지켜야 하는 것 (키)**

- **요청 헤더를 로그에 남기지 않는다.** 접근 로그·예외 로그가 헤더 전체를 찍고
  있다면 `X-PTX-LLM-KEYS` 는 빼거나 가린다.
- **그 요청 안에서만 쓴다.** 전역 config 에 써 넣지 않는다 (A/B 가 섞인다).
- 키가 회선을 타므로 PTX → 에이전트 구간은 내부망이거나 https 여야 한다.

**새 서버·새 키를 시험하는 데 에이전트는 아무것도 바꿀 필요가 없다.** PTX
`config.yml` 에 키를 추가하고 설정 화면에서 서버를 등록하면 끝이다.

---

## 2. role 이름은 enum 의 `.name` 이다

참조한 체크아웃의 실제 값을 보면 이렇다.

```
LLMModel.QWEN3.name       = "QWEN3"
LLMModel.QWEN3.value      = "Qwen3-235B-A22B-Instruct-2507-AWQ"
PRIVATE_LLM_MODEL_NAME    = "llama-3.3-70b-versatile"     ← config.dev.yml, 실제 호출 모델
```

`value` 는 실제 호출 모델명이 **아니다** — 라벨이다 (`main_model=...value` 처럼 메타데이터로
쓰인다). 그리고 모델명을 키로 쓰면 모델을 바꾸는 순간 키가 바뀌어 매칭이 깨진다.

```
MODEL_CTN 의 키   ←→  LLMModel.<멤버>.name        (슬롯 = 안 바뀌는 것)
그 값의 "model"   ──▶  LLMModelConfig.model 자리   (모델명 = 바꾸려는 것)
```

확인하고 PTX 실행 탭 `모델` 칸의 **role 관리** 에 있는 이름을 이 출력과 똑같이 맞춘다
(대소문자까지):

```bash
python -c "from config.settings import LLMModel; print([e.name for e in LLMModel])"
```

노드가 어떤 role 을 쓰는지는 `node/_base_agent.py` 의 `model_name_key` 가 이미 정하고 있다.
**노드 코드는 건드리지 않는다.**

---

## 3. 구현

### Step 1 — 조회 (신규 파일)

`src/workflows/v1_1/config/call_config.py`:

```python
"""PTX_CALL_MAS — 이 호출에 적용할 모델. 실패는 절대 밖으로 던지지 않는다."""

import json
import logging

from ..core.db import OracleDBManager

logger = logging.getLogger(__name__)

_SQL = "SELECT MODEL_CTN FROM PTX_CALL_MAS WHERE TRACE_ID = :t"


def load_call_models(trace_id: str | None) -> dict:
    """{role: {"model": ..., "temperature": ...}} — 없으면 빈 dict."""
    if not trace_id:                       # 운영 트래픽은 여기서 끝
        return {}
    try:
        conn = OracleDBManager.acquire()
        try:
            with conn.cursor() as cur:
                cur.execute(_SQL, t=trace_id)
                row = cur.fetchone()
        finally:
            conn.close()                   # pool 에 반납
        if not row or not row[0]:
            return {}
        ov = json.loads(row[0].read() if hasattr(row[0], "read") else row[0])
        return {k: v for k, v in ov.items() if isinstance(v, dict)}
    except Exception:
        logger.warning("PTX_CALL_MAS 조회 실패 — config 기본값 사용", exc_info=True)
        return {}
```

> CLOB 은 드라이버 설정에 따라 `LOB` 객체로 올 수 있어 `.read()` 를 태웠다.
> `oracledb.defaults.fetch_lobs = False` 를 쓰고 있으면 그냥 문자열이다.

### Step 2 — 진입점에서 한 번 조회해 컨텍스트에 싣는다

**호출마다 SELECT 를 날리지 말고 요청당 1회**만 조회한다. 노드가 5개면 5번 읽을 이유가 없다.

`core/llm.py` 에는 이미 호출 단위 `ContextVar` 가 있다 (`set_llm_call_context`, 지금은 토큰
집계용). 여기에 얹으면 `_executor.py` 는 **손댈 필요가 없다.**

```python
# core/llm.py
def set_llm_call_context(node_nm=None, trace_id=None, user_id=None, query=None,
                         call_models: dict | None = None,
                         call_keys: dict | None = None) -> None:
    _llm_call_context.set({..., "call_models": call_models or {},
                                "call_keys": call_keys or {}})
```

**키는 DB 가 아니라 요청 헤더에서 온다 (§1-1).** 헤더는 HTTP 진입점에서만 보이므로
그래프를 돌리기 **전에** 거기서 꺼내 둔다.

```python
# core/llm.py
_request_llm_keys: ContextVar[dict] = ContextVar("_request_llm_keys", default={})

def parse_llm_keys(raw: str | None) -> dict:
    """X-PTX-LLM-KEYS → {role: key}. 깨진 값은 없는 것으로 (로그에 값 찍지 말 것)."""
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return {k: s for k, s in v.items() if isinstance(s, str) and s}
    except Exception:
        logger.warning("X-PTX-LLM-KEYS 파싱 실패 — config 키 사용")
        return {}
```

```python
# 채팅 요청 핸들러 — 그래프 실행 직전
_request_llm_keys.set(parse_llm_keys(request.headers.get("X-PTX-LLM-KEYS")))
```

> ContextVar 는 **set 이후에 만들어진** asyncio task 로만 전파된다. 그래프가
> 스레드풀·별도 프로세스에서 돈다면 ContextVar 대신 state 에 실어 넘긴다
> (`session_system_prompt` 와 같은 경로).

```python
# _base_agent.py — invoke() 안. 엔벨로프 TRACE_ID 로만 조회한다.
trace_id = _resolve_trace_id(state)
set_llm_call_context(
    node_nm=...,
    trace_id=trace_id,
    user_id=...,
    query=...,
    call_models=load_call_models(_envelope_trace_id(state)),   # ← 추가
    call_keys=_request_llm_keys.get(),                          # ← 추가 (헤더에서)
)
```

```python
def _envelope_trace_id(state) -> str | None:
    """CUBE 엔벨로프에 실려 온 TRACE_ID 만. 없으면 None."""
    raw = getattr(state, "session_system_prompt", None)
    if not raw:
        return None
    try:
        return json.loads(raw).get("TRACE_ID")
    except (json.JSONDecodeError, TypeError, AttributeError):
        return None
```

> ⚠️ **`_resolve_trace_id()` 를 그대로 쓰면 안 된다.** 그 함수는 엔벨로프에 값이 없으면
> `state.context.trace_id`(자체 발번)로 폴백하므로 **항상** 채워진다. 그걸로 조회하면
> 운영 트래픽까지 매번 DB 를 때리게 되고, 만에 하나 id 가 겹치면 운영 응답의 모델이 바뀐다.
> 반드시 **엔벨로프에 실려 온 값**으로만 조회한다.
>
> 노드가 여러 개인 그래프에서 노드마다 `invoke` 가 돌면 조회도 노드 수만큼 일어난다.
> 신경 쓰이면 그래프 진입점(`workflow.py` 의 상태 초기화)에서 한 번 조회해 state 에 담고
> 노드는 그걸 읽게 한다.

### Step 3 — 호출 시 적용한다

```python
async def call_llm(messages, tools=None, model_name_key=None) -> BaseMessage:
    ctx = _llm_call_context.get() or {}
    name = model_name_key or _default_model_name
    ov = (ctx.get("call_models") or {}).get(name)     # role 이름으로 조회
    llm = _get_overridden_model(name, ov) if ov else get_llm(name)
    if tools:
        llm = llm.bind_tools(tools)
    return await llm.ainvoke(messages)


def _get_overridden_model(name: str, ov: dict) -> BaseChatModel:
    base = _model_configs[name]
    model = ov.get("model") or base.model              # 없으면 config 값 유지
    temp = ov.get("temperature")
    temp = base.temperature if temp is None else float(temp)
    url = ov.get("base_url") or base.base_url          # 모델이 떠 있는 서버
    ctx = _llm_call_context.get() or {}
    key = (ctx.get("call_keys") or {}).get(name) or base.api_key   # 헤더로 온 키 (§1-1)
    return _cached_override(name, model, temp, url, key)


@lru_cache(maxsize=64)
def _cached_override(name: str, model: str, temperature: float,
                     base_url: str, api_key: str | None) -> BaseChatModel:
    base = _model_configs[name]
    return _create_model(
        replace(base, model=model, temperature=temperature,
                base_url=base_url, api_key=api_key)
    )
```

`replace` 는 `dataclasses.replace` — `extra_body` 같은 나머지는 그대로 두고 바뀐
것만 갈아끼운다.

> ⚠️ **캐시 키에 `base_url` 이 들어가야 한다.** 모델명만 키로 잡으면 같은 모델을
> 다른 서버로 돌리는 두 실행이 먼저 만들어진 인스턴스를 같이 쓴다 — A/B 가
> 조용히 한쪽 주소로만 나가고, 그게 바로 이 기능을 넣은 이유를 무효로 만든다.
> `api_key` 를 캐시 키에 넣기 싫으면 `base_url` 까지만 키로 잡고 키는 그때 풀되,
> **같은 주소에 키만 다른 경우가 없다는 전제**가 필요하다.
>
> ⚠️ 헤더에 그 role 의 키가 없으면 config 의 키로 떨어진다. `MODEL_CTN` 에
> `api_key_ref` 가 있는데 헤더에 키가 없다면 PTX `config.yml` 의 `llmKeys` 에 그
> 이름이 빠진 것이다 — PTX 로그에 `LLM key name not in config.yml llmKeys` 가 찍힌다.
> 401 을 보면 그 로그부터 본다.

> ⚠️ **`maxsize` 를 무제한으로 두지 말 것.** 캐시 키에 임의의 모델명이 들어오므로
> `maxsize=None` 이면 테스트를 돌릴수록 인스턴스가 무한히 쌓인다. 운영 경로(`get_llm`)의
> 캐시는 지금 그대로 둔다 — override 없는 호출은 그쪽으로 가고, 그 키 집합은 유한하다.

### Step 4 — DB 커넥션 확보

`core/db.py` 의 `OracleDBManager` 는 접속 정보를 클래스 속성으로 받고 `initialize()` 에서
풀을 만든다. 참조한 체크아웃에서는 워크플로우 프로세스가 이걸 초기화하는 코드가 없었다
(`mcp/mcp_server.py` 는 자기 몫의 `mcp/db.py` 를 따로 초기화한다). 이미 하고 있으면 건너뛴다.

```python
# workflow.py 초기화 블록 맨 앞
if config.ORACLE_DB_DSN:                  # DSN 이 비면 initialize() 가 던진다
    OracleDBManager.user = config.ORACLE_DB_USER
    OracleDBManager.passwd = config.ORACLE_DB_PASSWD
    OracleDBManager.dsn = config.ORACLE_DB_DSN
    OracleDBManager.min = config.ORACLE_DB_POOL_MIN
    OracleDBManager.max = config.ORACLE_DB_POOL_MAX
    OracleDBManager.increment = config.ORACLE_DB_POOL_INCREMENT
    OracleDBManager.initialize()
```

`v1_0` 과 `v1_1` 은 구조가 같으므로 두 버전을 다 쓰면 양쪽에 같은 작업을 한다.

---

## 4. 검증

1. **DB 접속** — 에이전트 계정으로 `SELECT * FROM PTX_CALL_MAS` 가 되는지.
   PTX 와 **같은 DB** 를 보고 있는지도 같이 확인한다.
2. **조회 단독** — PTX 에서 Single 을 한 번 돌려 행을 만든 뒤, 그 `TRACE_ID` 로
   `load_call_models()` 가 dict 를 돌려주는지. 없는 id 면 `{}` 인지.
3. **role 이름** — `[e.name for e in LLMModel]` 과 `모델` 칸에 뜨는 이름을 대조.
4. **운영 경로** — `TRACE_ID` 없이 호출 → 로그의 모델명이 **기존 그대로**인지.
   바뀌거나 DB 조회 로그가 찍히면 게이트가 새는 것이다 (Step 2 ⚠️).
5. **적용 경로** — Single 탭 모델 칸에서 모델을 고르고 실행 → 로그의 모델명과
   **호출 주소**가 그 모델이 등록된 서버인지.
5-1. **서버별 분리** — 서로 다른 서버에 등록된 두 모델을 번갈아 돌려 주소가
   실제로 따라 바뀌는지. 안 바뀌면 캐시 키 문제다 (Step 3 ⚠️).
6. **A/B** — Compare 에서 A 와 B 에 **서로 다른 모델**을 넣고 실행 → 로그에 두 모델이
   각각 찍혀야 한다. 같으면 에이전트가 전역에 적용한 것이다 (Step 3 ⚠️).
7. **부분 지정** — `temperature` 만 있는 role 이 모델명은 config 값을 유지하는지.
8. **DB 차단 시** — DSN 을 일부러 틀리게 하고 에이전트가 경고만 남기고 정상 기동·응답하는지.

---

## 5. 실패 모드

| 증상 | 원인 |
|---|---|
| A 와 B 가 같은 모델로 돎 | override 를 전역에 적용 (Step 3 을 `initialize()` 재호출로 구현) |
| 운영 트래픽까지 바뀜 / DB 를 매번 때림 | `_resolve_trace_id()` 로 조회 (Step 2 ⚠️) |
| 특정 role 만 반영 안 됨 | role 이름 ≠ `LLMModel.<멤버>.name` |
| 모델은 바뀌는데 주소는 그대로 | `replace` 에 `base_url` 을 안 넘김 (Step 3) |
| A/B 가 같은 주소로 나감 | override 캐시 키에 `base_url` 이 없음 (Step 3 ⚠️) |
| 새 서버에서만 401 | PTX `config.yml` `llmKeys` 에 그 이름이 없음 / 에이전트가 헤더를 컨텍스트에 안 실음 (§1-1, Step 2) |
| 전부 무시됨 | 조회 실패 — `PTX_CALL_MAS 조회 실패` 경고 로그 확인. 다른 DB 를 보고 있을 수도 |
| `MODEL_CTN` 이 비어 보임 | CLOB 을 `.read()` 안 함 (Step 1 주석) |
| 메모리가 계속 늚 | override 캐시가 무제한 (Step 3 ⚠️) |
| temperature 만 안 먹음 | `ov.get("temperature")` 를 truthy 검사로 처리 (0.0 이 falsy) |

---

## 6. 체크리스트

- [ ] `GRANT SELECT ON PTX_CALL_MAS TO <agent_user>`
- [ ] 에이전트 DSN = PTX DSN (같은 DB)
- [ ] `OracleDBManager.initialize()` — DSN 없을 때 가드 포함
- [ ] `[e.name for e in LLMModel]` ↔ `모델` 칸의 role 이름 일치 (대소문자까지)
- [ ] `config/call_config.py` — 예외를 밖으로 던지지 않음
- [ ] **엔벨로프 `TRACE_ID` 로만 조회** (자체 발번 폴백 금지)
- [ ] 요청당 1회 조회 (노드마다 반복 금지)
- [ ] `call_llm` 이 `ContextVar` 에서 읽어 **그 호출에만** 적용
- [ ] override 캐시 `maxsize` 유한
- [ ] `model` / `temperature` / `base_url` 각각 없을 때 config 값 유지 (`temperature=0.0` 포함)
- [ ] override 캐시 키에 `base_url` 포함
- [ ] HTTP 진입점에서 `X-PTX-LLM-KEYS` 를 읽어 `call_keys` 로 컨텍스트에 싣음 (Step 2)
- [ ] 요청 헤더가 로그에 찍히지 않음 (§1-1)
- [ ] PTX 설정의 **LLM 서버** 이름·주소가 실제 서빙 주소와 맞는지
- [ ] `v1_0` / `v1_1` 양쪽 적용
- [ ] 검증 1~8 통과 (특히 4번과 6번)

## 7. 롤백

`call_llm` 의 override 분기 한 줄을 지우면 모든 호출이 config 로 돌아간다. PTX 는 계속
`PTX_CALL_MAS` 에 행을 남기지만 아무도 안 읽을 뿐이라 깨지는 게 없다.
