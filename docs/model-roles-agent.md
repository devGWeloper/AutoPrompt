# LLM role 별 모델 — 에이전트 쪽 연동 가이드

에이전트 config 는 LLM 을 role 로 나눠 정의한다 (`llm` / `vlm` / `light_llm` / `judge_llm`).
모델을 바꿔가며 테스트할 때마다 그 config 를 손으로 고치는 대신, **PTX 가 호출마다 "이번엔
이 모델로 돌려라"를 요청에 실어 보낸다.**

```
PTX /models 화면 ──save──▶ PTX_MODEL_MAS (기준값)
                                  │
                  PTX 가 읽어서 요청에 실음
                                  ▼
POST /completion  session_system_prompt = {"TRACE_ID": "...", "MODEL_OVERRIDE": {...}}
                                  │
                                  ▼
                            에이전트: 이 호출에만 적용
```

**에이전트는 DB 를 읽지 않는다.** 모델 설정은 전부 요청에 실려 온다.

이 방식이라야 하는 이유가 둘이다.

1. **A/B 한쪽만 모델을 바꿀 수 있다.** 전역 설정을 바꿔놓고 재는 방식으로는 두 사이드가
   같은 값을 볼 수밖에 없다. 설정이 요청과 함께 다니면 A 는 기준값, B 는 다른 모델로 같은
   데이터셋을 돌릴 수 있다.
2. **운영 트래픽이 완전히 격리된다.** `MODEL_OVERRIDE` 가 없는 요청 = 운영 트래픽이고,
   그건 지금까지처럼 자기 config 로 돈다. 전역 플래그(`ACTIVE_YN` 류)로는 이게 안 된다 —
   플래그가 켜져 있는 동안 들어온 운영 요청도 같이 바뀌기 때문이다.

PTX 쪽은 끝났다. 이 문서는 **에이전트(`C:\work\aiai`) 쪽에서 할 일**을 적은 것이다.
경로·줄번호는 이 저장소가 참조한 체크아웃 기준이라, 실 환경과 다르면 구조만 가져다 쓰면 된다.

---

## 1. 계약

**PTX 가 보내는 것** — `session_system_prompt`(문자열화된 JSON) 안에 키 하나가 늘어난다.

```json
{
  "CUBE_CHANNEL_ID": "11111111",
  "CUBE_USER_ID": "pm-test",
  "TRACE_ID": "PTX-20260812-0001",
  "MODEL_OVERRIDE": {
    "LLM": { "model": "Qwen3-235B-A22B-Instruct-2507-AWQ", "temperature": 0.3 },
    "VLM": { "model": "qwen2-vl-72b" }
  }
}
```

- **키는 role 이름.** 에이전트 `LLMModel` enum 의 **멤버 이름(`.name`)** 과 글자까지 같다
  (§2 참조). PTX `/models` 화면에서 그 이름으로 등록한다.
- `model` / `temperature` 는 **각각 없을 수 있다.** 없는 항목은 건드리지 말고 config 값을
  그대로 쓴다.
- **`MODEL_OVERRIDE` 자체가 없을 수 있다.** 지정된 게 하나도 없거나, 운영 트래픽이거나.
  그때는 지금과 완전히 동일하게 동작해야 한다.
- 요청 본문의 다섯 키(`message` / `user_id` / `session_id` / `chat_type` /
  `session_system_prompt`)는 그대로다. **요청 형식은 안 바뀐다.**

**에이전트가 지켜야 하는 것**

- **이 호출에만 적용한다.** 전역 설정을 바꾸지 않는다 — 동시에 들어온 다른 요청이 영향받으면
  A/B 가 무의미해진다.
- **모르는 role 은 무시한다.** enum 에 없는 키가 와도 그냥 넘긴다.
- **파싱 실패는 무시한다.** `MODEL_OVERRIDE` 가 깨져 있어도 호출은 config 로 진행한다.
  단 경고 로그는 남긴다.
- **`base_url` / `api_key` 는 계속 config 에서 온다.** role 이 공통으로 쓰는 값이고,
  요청으로 받을 이유가 없다.

> 앞선 버전의 이 문서는 에이전트가 `PTX_MODEL_MAS` 를 직접 SELECT 하는 설계였다. 그쪽은
> A/B 한쪽만 바꾸는 게 불가능해서 폐기했다. **DB 로더 · 리로드 · `GRANT SELECT` 는 전부
> 필요 없다.** 이미 만들었다면 지우면 된다.

---

## 2. 지금 코드가 어떻게 도는지

먼저 이 네 파일을 읽고 시작한다.

| 파일 | 역할 |
|---|---|
| `src/workflows/v1_1/config/settings.py` | `LLM_MODELS = { LLMModel.X: LLMModelConfig(...) }` 조립 |
| `src/workflows/v1_1/core/llm.py` | `call_llm()` → `get_llm()` → `_get_cached_model()` (`@lru_cache`) → `ChatOpenAI`. 호출 컨텍스트 `ContextVar` 도 여기 있다 |
| `src/workflows/v1_1/node/_base_agent.py` | 노드 진입점. `_resolve_trace_id()` + `set_llm_call_context()` 호출 |
| `src/workflows/v1_1/node/_executor.py` | `call_llm(messages, model_name_key=...)` 실제 호출부 |

노드가 어떤 role 을 쓰는지는 `node/_base_agent.py` 의 클래스 속성이 정한다:

```python
class BaseAgent(ABC):
    model_name_key: Optional[str] = None    # None 이면 DEFAULT_LLM_MODEL
```

**노드 → role 매핑은 이미 코드 안에 있다.** 이번 작업은 그 매핑이 아니라, role 이 가리키는
**모델명의 출처**에 "이번 호출만" 이라는 경로를 하나 더 여는 것이다.

### role 이름은 enum 의 `.name` 이다

참조한 체크아웃의 실제 값을 보면 이렇다.

```
LLMModel.QWEN3.name       = "QWEN3"
LLMModel.QWEN3.value      = "Qwen3-235B-A22B-Instruct-2507-AWQ"
PRIVATE_LLM_MODEL_NAME    = "llama-3.3-70b-versatile"     ← config.dev.yml, 실제 호출 모델
```

`value` 는 실제 호출 모델명이 **아니다** — 라벨이다 (`main_model=...value` 처럼 메타데이터로
쓰인다). 그리고 모델명을 키로 쓰면 모델을 바꾸는 순간 키가 바뀌어 매칭이 깨진다. 그래서
role 이름은 슬롯 이름인 `.name` 과 맞춘다.

```
MODEL_OVERRIDE 의 키  ←→  LLMModel.<멤버>.name        (슬롯 = 안 바뀌는 것)
그 값의 "model"       ──▶ LLMModelConfig.model 자리   (모델명 = 바꾸려는 것)
```

확인:

```bash
python -c "from config.settings import LLMModel; print([e.name for e in LLMModel])"
```

PTX `/models` 화면의 role 이름을 여기 출력과 똑같이 맞춘다 (대소문자까지).

---

## 3. 구현

### Step 1 — 엔벨로프에서 override 를 꺼낸다

`node/_base_agent.py`, `_resolve_trace_id` 옆에:

```python
def _resolve_model_override(state: GraphState) -> dict:
    """CUBE 엔벨로프의 MODEL_OVERRIDE — 없거나 깨졌으면 빈 dict(= config 그대로)."""
    raw = getattr(state, "session_system_prompt", None)
    if not raw:
        return {}
    try:
        ov = json.loads(raw).get("MODEL_OVERRIDE")
    except (json.JSONDecodeError, TypeError, AttributeError):
        return {}
    if not isinstance(ov, dict):
        return {}
    return {k: v for k, v in ov.items() if isinstance(v, dict)}
```

> ⚠️ **`trace_id` 유무로 판단하지 말 것.** `_resolve_trace_id` 는 엔벨로프에 없으면
> `state.context.trace_id`(자체 발번)로 폴백해서 값이 **항상** 채워진다. 게이트는 반드시
> `MODEL_OVERRIDE` 키의 존재로 건다.

### Step 2 — 호출 컨텍스트에 싣는다

`core/llm.py` 에는 이미 호출 단위 `ContextVar` 가 있다 (`set_llm_call_context`, 지금은 토큰
집계용). 여기에 얹으면 `_executor.py` 는 **손댈 필요가 없다.**

```python
# core/llm.py
def set_llm_call_context(node_nm=None, trace_id=None, user_id=None, query=None,
                         model_override: dict | None = None) -> None:
    _llm_call_context.set({..., "model_override": model_override or {}})
```

```python
# _base_agent.py — invoke() 안
set_llm_call_context(
    node_nm=...,
    trace_id=_resolve_trace_id(state),
    user_id=...,
    query=...,
    model_override=_resolve_model_override(state),      # ← 추가
)
```

### Step 3 — 호출 시 override 를 적용한다

`call_llm` 이 컨텍스트를 읽어 그 호출에 쓸 인스턴스를 고른다.

```python
async def call_llm(messages, tools=None, model_name_key=None) -> BaseMessage:
    ctx = _llm_call_context.get() or {}
    name = model_name_key or _default_model_name
    ov = (ctx.get("model_override") or {}).get(name)      # role 이름으로 조회
    llm = _get_overridden_model(name, ov) if ov else get_llm(name)
    if tools:
        llm = llm.bind_tools(tools)
    return await llm.ainvoke(messages)


def _get_overridden_model(name: str, ov: dict) -> BaseChatModel:
    """override 가 걸린 호출용 인스턴스. 캐시 키에 override 를 포함해,
    같은 조합이 반복되면 재사용하고 서로 다른 조합은 섞이지 않는다."""
    base = _model_configs[name]
    model = ov.get("model") or base.model                 # 없으면 config 값 유지
    temp = ov.get("temperature")
    temp = base.temperature if temp is None else float(temp)
    return _cached_override(name, model, temp)


@lru_cache(maxsize=64)
def _cached_override(name: str, model: str, temperature: float) -> BaseChatModel:
    base = _model_configs[name]
    return _create_model(replace(base, model=model, temperature=temperature))
```

`replace` 는 `dataclasses.replace` — `base_url` / `api_key` / `extra_body` 는 그대로 두고
바뀐 것만 갈아끼운다.

> ⚠️ **`maxsize` 를 무제한으로 두지 말 것.** 캐시 키에 임의의 모델명이 들어오므로
> `maxsize=None` 이면 테스트를 돌릴수록 인스턴스가 무한히 쌓인다. 운영 경로(`get_llm`)의
> 캐시는 지금 그대로 두면 된다 — override 없는 호출은 그쪽으로 가고, 그 키 집합은 유한하다.

`v1_0` 과 `v1_1` 은 구조가 같으므로 두 버전을 다 쓰면 양쪽에 같은 작업을 한다.

---

## 4. 검증

1. **파싱 단독** — `MODEL_OVERRIDE` 가 실린 `session_system_prompt` 문자열로
   `_resolve_model_override` 가 dict 를 돌려주는지. 깨진 JSON 이면 `{}` 인지.
2. **운영 경로** — `MODEL_OVERRIDE` 없이 호출 → 로그의 모델명이 **기존 그대로**인지.
   바뀌면 게이트가 새는 것이다.
3. **override 경로** — PTX Single 실행 → 로그의 모델명이 `/models` 에 넣은 값인지.
4. **role 이름** — 특정 role 만 안 먹으면 이름 불일치다.
   `[e.name for e in LLMModel]` 과 `/models` 화면의 이름을 대조한다.
5. **A/B** — Compare 에서 `모델` 행의 B 에 다른 모델을 넣고 실행 → **A 와 B 로그의 모델명이
   서로 달라야** 한다. 같으면 override 가 전역으로 새거나 컨텍스트가 사이드를 안 타는 것이다.
6. **동시성** — A/B 를 돌리는 중에 운영 요청을 하나 끼워 넣고 그 요청이 config 모델로
   나가는지. 전역 상태를 건드렸다면 여기서 깨진다.
7. **부분 지정** — `temperature` 만 실린 role 이 모델명은 config 값을 유지하는지.

---

## 5. 실패 모드

| 증상 | 원인 |
|---|---|
| A 와 B 가 같은 모델로 돎 | override 를 전역에 적용 (Step 3 을 `initialize()` 재호출로 구현한 경우) |
| 운영 트래픽까지 바뀜 | `trace_id` 유무로 게이트를 걺 (Step 1 ⚠️) |
| 특정 role 만 반영 안 됨 | role 이름 ≠ `LLMModel.<멤버>.name` |
| 전부 무시됨 | `session_system_prompt` 파싱 실패 — 경고 로그 확인 |
| 메모리가 계속 늚 | override 캐시가 무제한 (Step 3 ⚠️) |
| temperature 만 안 먹음 | `ov.get("temperature")` 를 truthy 검사로 처리 (0.0 이 falsy) |

---

## 6. 체크리스트

- [ ] `[e.name for e in LLMModel]` ↔ PTX `/models` 의 role 이름 일치 (대소문자까지)
- [ ] `_resolve_model_override()` — 예외를 밖으로 던지지 않음
- [ ] `set_llm_call_context(..., model_override=...)`
- [ ] `call_llm` 이 `ContextVar` 에서 읽어 **그 호출에만** 적용
- [ ] override 캐시 `maxsize` 유한
- [ ] `model` / `temperature` 각각 없을 때 config 값 유지 (`temperature=0.0` 포함)
- [ ] `v1_0` / `v1_1` 양쪽 적용
- [ ] 검증 1~7 통과 (특히 2번과 5번)

## 7. 롤백

`call_llm` 의 override 분기 한 줄을 지우면 모든 호출이 config 로 돌아간다. PTX 는 계속
`MODEL_OVERRIDE` 를 보내지만 무시될 뿐이라 아무것도 깨지지 않는다.
