# LLM role 별 모델 — 에이전트 쪽 연동

에이전트 config 는 LLM 을 role 로 나눠 정의한다 (`llm` / `vlm` / `light_llm` / `judge_llm`).
테스트할 때마다 그 config 를 손으로 고치는 대신, PTX 화면에서 role 별 모델명을 바꾸고
에이전트가 그 값을 읽어 쓴다.

## 계약

- **조인 키는 `ROLE_CD` 하나.** `PTX_MODEL_MAS.ROLE_CD` 는 에이전트 `LLMModel` enum 의
  value 와 글자까지 같아야 한다. 다르면 그 role 은 영영 안 읽힌다.
- **PTX 는 모델명만 준다.** `base_url` / `api_key` 는 role 4종 공통이라 계속 에이전트
  config 에서 온다. 키를 DB 에 두면 `PTX_AUDIT_HIS` 의 before/after 스냅샷에 평문으로
  복사되므로 넣지 않는다.
- **`MODEL_NM` 이 NULL 이면 기존 동작.** config 의 모델명을 그대로 쓴다. DB 가 안 뜨거나
  행이 없을 때도 마찬가지 — 연동이 에이전트를 죽이면 안 된다.
- **에이전트는 이 표를 읽기만 한다.** `GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>`.

## 고치는 곳: config 파일이 아니라 config 를 읽는 코드

현재 흐름은 이렇다.

```
config.dev.yml → temp/config.py (import 시 1회 read)
              → config/settings.py : LLM_MODELS = { LLMModel.X: LLMModelConfig(...) }
              → workflow.py        : init_llm(LLM_MODELS, DEFAULT_LLM_MODEL)   ← import 시점
              → core/llm.py        : _get_cached_model()  ← ChatOpenAI 인스턴스 캐시
```

yml 을 건드리지 않는 이유가 셋이다.

1. **없어질 파일이다.** `temp/config.py` 주석대로 이관 시 사내 config 라이브러리로 교체된다.
2. **PTX 는 다른 프로세스다.** 파일에 쓸 수 없다.
3. **import 시점 1회 로드**라 파일을 바꿔도 재기동 전엔 반영되지 않는다.

값을 조립하는 자리인 `config/settings.py` 가 맞는 seam 이다.

```python
# config/settings.py
_COMMON = dict(
    base_url=config.PRIVATE_LLM_ENDPOINT,
    api_key=config.PRIVATE_LLM_API_KEY,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
)
_FALLBACK = {                      # DB 가 비었거나 안 뜰 때의 기존 동작
    LLMModel.LLM: config.PRIVATE_LLM_MODEL_NAME,
    # ...
}

def build_llm_models() -> dict:
    overrides = load_model_roles()          # {ROLE_CD: (MODEL_NM, TEMPERATURE)}
    out = {}
    for role in LLMModel:
        model_nm, temp = overrides.get(role.value, (None, None))
        kwargs = dict(_COMMON)
        if temp is not None:
            kwargs["temperature"] = temp
        out[role] = LLMModelConfig(model=model_nm or _FALLBACK[role], **kwargs)
    return out

LLM_MODELS = build_llm_models()
```

loader:

```python
import oracledb

def load_model_roles() -> dict[str, tuple[str | None, float | None]]:
    """{ROLE_CD: (MODEL_NM, TEMPERATURE)} — 실패하면 빈 dict(= config 기본값)."""
    try:
        with oracledb.connect(user=..., password=..., dsn=...) as conn, conn.cursor() as cur:
            cur.execute("SELECT ROLE_CD, MODEL_NM, TEMPERATURE FROM PTX_MODEL_MAS")
            return {r[0]: (r[1], float(r[2]) if r[2] is not None else None) for r in cur}
    except Exception:
        logger.warning("model role load failed — config 기본값 사용", exc_info=True)
        return {}
```

## 함정: `lru_cache` 때문에 재초기화만으로는 안 바뀐다

`core/llm.py` 의 `_get_cached_model` 이 `@lru_cache(maxsize=None)` 다. `initialize()` 를
다시 불러도 캐시에 옛 `ChatOpenAI` 가 남아 예전 모델로 계속 호출된다. 리로드는 반드시
캐시를 비우고 해야 한다.

```python
def reload_llm_models() -> None:
    _get_cached_model.cache_clear()     # ← 이게 없으면 아무 일도 일어나지 않는다
    initialize(models=build_llm_models(), default_model=DEFAULT_LLM_MODEL)
```

**호출 시점은 요청 진입 시 1회**를 권한다. `PTX_MODEL_MAS` 를 읽어 직전 스냅샷과 다를
때만 `reload_llm_models()` — 4행 조회라 비용은 무시할 수준이고, PTX 에서 모델을 바꾼 뒤
재기동 없이 바로 테스트를 돌릴 수 있다. `v1_0` / `v1_1` 구조가 같으므로 양쪽 다 손봐야 한다.

## 지켜야 할 것

- **실패는 조용히 기본값으로.** DB 가 안 떠도 에이전트는 떠야 한다. 단 `logger.warning` 은
  남긴다 — 아무 로그도 없이 기본값으로 도는 게 제일 나쁘다.
- **모르는 role 은 무시.** `PTX_MODEL_MAS` 에 enum 에 없는 `ROLE_CD` 가 있어도 그냥 넘긴다
  (enum 을 돌며 조회하는 위 코드는 자연히 그렇게 된다).
- **`temperature` 는 NULL 이면 건드리지 않는다.** `LLMModelConfig` 의 기본값(0.1)이 살아야 한다.
