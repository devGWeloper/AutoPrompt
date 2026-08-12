# LLM role 별 모델 — 에이전트 쪽 연동 가이드

에이전트 config 는 LLM 을 role 로 나눠 정의한다 (`llm` / `vlm` / `light_llm` / `judge_llm`).
모델을 바꿔가며 테스트할 때마다 그 config 를 손으로 고치는 대신, **PTX 화면에서 role 별
모델명을 바꾸고 에이전트가 그 값을 읽어 쓴다.**

```
PTX (/models 화면)  ──write──▶  PTX_MODEL_MAS  ◀──read──  에이전트 (config 조립 시)
                                  ROLE_CD
                                  MODEL_NM
                                  TEMPERATURE
```

PTX 쪽은 끝났다. 이 문서는 **에이전트(`C:\work\aiai`) 쪽에서 할 일**을 순서대로 적은 것이다.
경로·줄번호는 이 저장소가 참조한 체크아웃 기준이라, 실 환경과 다르면 구조만 가져다 쓰면 된다.

---

## 1. 계약

**PTX 가 보장하는 것**

- `PTX_MODEL_MAS` 에 role 당 최대 한 행이다 (`ROLE_CD` UNIQUE). **행이 없는 role 은 override
  가 없다는 뜻**이므로 에이전트는 config 기본값으로 돈다 — role 집합의 주인은 여전히
  에이전트의 `LLMModel` enum 이고, PTX 화면의 추가·삭제는 그걸 따라가는 수단일 뿐이다.
- `MODEL_NM` / `TEMPERATURE` 는 NULL 일 수 있다. **NULL = "건드리지 마라"**, 즉 에이전트
  config 의 기존 값을 그대로 쓰라는 뜻이다.
- 값이 바뀌면 `PTX_AUDIT_HIS` 에 before/after 가 남는다. "언제 누가 뭘 바꿨나"는 PTX 쪽에서
  추적되므로 에이전트가 이력을 남길 필요는 없다.

**에이전트가 지켜야 하는 것**

- **조인 키는 `ROLE_CD` 하나.** `LLMModel` enum 의 value 와 글자까지 같아야 한다.
- **읽기만 한다.** `GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>` 외의 권한은 필요 없다.
- **DB 가 없어도 뜬다.** 조회 실패는 경고 로그를 남기고 config 기본값으로 진행한다.
- **`base_url` / `api_key` 는 계속 config 에서 온다.** role 4종이 공통으로 쓰는 값이고,
  키를 DB 에 두면 `PTX_AUDIT_HIS` 스냅샷에 평문으로 복사된다.

---

## 2. 지금 코드가 어떻게 도는지

먼저 이 네 파일을 읽고 시작한다.

| 파일 | 역할 |
|---|---|
| `src/workflows/v1_1/temp/config.py` | `config.dev.yml` 을 **import 시점에 1회** 읽어 모듈 변수로 노출 |
| `src/workflows/v1_1/config/settings.py` | `LLM_MODELS = { LLMModel.X: LLMModelConfig(...) }` 조립 |
| `src/workflows/v1_1/workflow.py` | `init_llm(LLM_MODELS, DEFAULT_LLM_MODEL)` — **모듈 import 시점** |
| `src/workflows/v1_1/core/llm.py` | `get_llm()` → `_get_cached_model()` (`@lru_cache`) → `ChatOpenAI` |

```
config.dev.yml → temp/config.py → settings.py: LLM_MODELS → workflow.py: init_llm(...)
                                                          → core/llm.py: _get_cached_model()
```

노드가 어떤 role 을 쓰는지는 `node/_base_agent.py` 의 클래스 속성이 정한다:

```python
class BaseAgent(ABC):
    model_name_key: Optional[str] = None    # None 이면 DEFAULT_LLM_MODEL
```

즉 **노드 → role 매핑은 이미 코드 안에 있다.** 이번 작업은 그 매핑을 바꾸는 게 아니라,
role 이 가리키는 **모델명의 출처**만 config 에서 DB 로 옮기는 것이다.

`app.py` 는 FastAPI 이고, `lifespan` 에서 `discover_and_load_workflows()` 가 버전별
`workflow.py` 를 동적 import 한다. 요청 엔드포인트는
`POST /api/{version}/api/completion` 하나다.

---

## 3. 왜 `config.dev.yml` 이 아니라 코드를 고치는가

세 가지 이유다.

1. **그 파일은 없어질 파일이다.** `temp/config.py` 주석대로 이관 시 사내 config
   라이브러리로 교체된다. yml 에 기대는 설계는 그때 깨진다.
2. **PTX 는 다른 프로세스다.** 파일에 쓸 수 없다.
3. **import 시점 1회 로드다.** 파일을 바꿔도 재기동 전엔 반영되지 않는다.

값을 **조립하는** 자리인 `config/settings.py` 가 손댈 seam 이다. 거기서 "공통값은 config,
모델명은 DB" 로 갈라주면 나머지 코드는 그대로 둔다.

---

## 4. 구현

### Step 0 — 사전 확인 (코드 건드리기 전에)

- [ ] `LLMModel` enum 의 **value 문자열**을 확인한다. PTX seed 는
      `llm` / `vlm` / `light_llm` / `judge_llm` 로 넣어뒀다. 다르면 DB 쪽을 실제 value 로
      맞춘다 (`UPDATE PTX_MODEL_MAS SET ROLE_CD = :real WHERE ROLE_CD = :seeded`).
- [ ] 에이전트 DB 계정으로 `SELECT * FROM PTX_MODEL_MAS` 가 되는지 확인한다.
      안 되면 `GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>`.
- [ ] `config.dev.yml` 의 `ORACLE_DB_USER / ORACLE_DB_PASSWD / ORACLE_DB_DSN` 이
      PTX 가 쓰는 DB 와 같은 곳을 가리키는지 확인한다. **다른 DB 면 이 연동은 성립하지 않는다.**

### Step 1 — DB 커넥션 확보

`core/db.py` 의 `OracleDBManager` 는 접속 정보를 **클래스 속성으로 받고** `initialize()`
에서 풀을 만든다. 참조한 체크아웃에서는 워크플로우 프로세스가 이걸 초기화하는 코드가
없었다 (`mcp/mcp_server.py` 는 자기 몫의 `mcp/db.py` 를 따로 초기화한다). 이미 초기화하고
있다면 이 단계는 건너뛴다.

`workflow.py` 초기화 블록 맨 앞에:

```python
from .core.db import OracleDBManager
from .temp import config

OracleDBManager.user = config.ORACLE_DB_USER
OracleDBManager.passwd = config.ORACLE_DB_PASSWD
OracleDBManager.dsn = config.ORACLE_DB_DSN
OracleDBManager.min = config.ORACLE_DB_POOL_MIN
OracleDBManager.max = config.ORACLE_DB_POOL_MAX
OracleDBManager.increment = config.ORACLE_DB_POOL_INCREMENT
OracleDBManager.initialize()          # 이미 초기화돼 있으면 경고만 남기고 넘어간다
```

> DSN 이 비어 있으면 `initialize()` 가 던진다. **DB 미설정 환경에서도 에이전트는 떠야 하므로**
> `if config.ORACLE_DB_DSN:` 으로 감싸거나 `try/except` 로 감싸고 경고만 남긴다.

### Step 2 — loader 추가 (신규 파일)

`src/workflows/v1_1/config/model_roles.py`:

```python
"""PTX_MODEL_MAS — role 별 모델 override 로더.

PTX 화면에서 지정한 값을 읽어온다. 실패는 절대 밖으로 던지지 않는다 —
DB 가 없어도 에이전트는 config 기본값으로 떠야 한다.
"""

import logging

from ..core.db import OracleDBManager

logger = logging.getLogger(__name__)

# {ROLE_CD: (MODEL_NM, TEMPERATURE)} — 값은 None 일 수 있다(= config 기본값 유지)
ModelRoles = dict[str, tuple[str | None, float | None]]

_SQL = "SELECT ROLE_CD, MODEL_NM, TEMPERATURE FROM PTX_MODEL_MAS"


def load_model_roles() -> ModelRoles:
    try:
        conn = OracleDBManager.acquire()
        try:
            with conn.cursor() as cur:
                cur.execute(_SQL)
                return {
                    str(r[0]): (r[1], float(r[2]) if r[2] is not None else None)
                    for r in cur
                }
        finally:
            conn.close()          # pool 에 반납
    except Exception:
        logger.warning("PTX_MODEL_MAS 조회 실패 — config 기본값을 사용합니다", exc_info=True)
        return {}
```

`core` 만 import 하고 `settings` 는 import 하지 않는다 — `settings` 가 이 모듈을 쓰므로
순환 import 가 된다.

### Step 3 — `settings.py` 에서 조립 방식 변경

```python
from .model_roles import ModelRoles, load_model_roles

# 4종이 공통으로 쓰는 값 — 계속 config 에서 온다
_COMMON = dict(
    base_url=config.PRIVATE_LLM_ENDPOINT,
    api_key=config.PRIVATE_LLM_API_KEY,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
)

# DB 가 비었을 때의 기존 동작 — 지금 하드코딩돼 있는 모델명 그대로
_FALLBACK_MODEL_NM = {
    LLMModel.LLM: config.PRIVATE_LLM_MODEL_NAME,
    # LLMModel.VLM: ...,
    # LLMModel.LIGHT_LLM: ...,
    # LLMModel.JUDGE_LLM: ...,
}


def build_llm_models(overrides: ModelRoles | None = None) -> dict:
    """role 별 LLMModelConfig. overrides 에 없는 role 은 기존 동작 그대로."""
    overrides = overrides or {}
    out = {}
    for role in LLMModel:
        model_nm, temp = overrides.get(role.value, (None, None))
        kwargs = dict(_COMMON)
        if temp is not None:                    # NULL 이면 dataclass 기본값(0.1) 유지
            kwargs["temperature"] = temp
        out[role] = LLMModelConfig(
            model=model_nm or _FALLBACK_MODEL_NM[role],
            **kwargs,
        )
    return out


LLM_MODELS = build_llm_models(load_model_roles())
DEFAULT_LLM_MODEL = LLMModel.LLM
```

`enum` 을 돌면서 조회하므로 **DB 에 enum 에 없는 `ROLE_CD` 가 있어도 자연히 무시된다.**

### Step 4 — `lru_cache` 를 비운다 ⚠️

여기가 이 작업에서 제일 잘 틀리는 곳이다.

`core/llm.py` 의 `_get_cached_model` 은 `@lru_cache(maxsize=None)` 다. **`initialize()` 를
다시 불러도 캐시에 옛 `ChatOpenAI` 가 남아 예전 모델로 계속 호출된다.** DB 를 고치고
재초기화까지 했는데 아무것도 안 바뀌는, 원인 찾기 고약한 증상이 나온다.

`initialize()` 안에서 비우는 게 맞다 — 재초기화가 진짜 재초기화가 되도록:

```python
def initialize(models: Dict[str, LLMModelConfig], default_model: str) -> None:
    global _model_configs, _default_model_name
    ...
    _model_configs = dict(models)
    _default_model_name = default_model
    _get_cached_model.cache_clear()      # ← 추가되는 줄
    get_llm(default_model)
```

### Step 5 — 언제 다시 읽을 것인가

**요청 진입 시 1회**를 권한다. 4행 조회라 비용은 무시할 수준이고, PTX 에서 모델을 바꾼 뒤
재기동 없이 바로 테스트를 돌릴 수 있다. 값이 안 바뀌었으면 아무것도 하지 않는다.

`workflow.py` 에 추가:

```python
from .config.settings import build_llm_models
from .config.model_roles import load_model_roles

_applied_roles: dict | None = None


def sync_llm_models() -> bool:
    """PTX 값이 바뀌었으면 LLM 을 다시 만든다. 바뀐 게 없으면 no-op."""
    global _applied_roles
    roles = load_model_roles()
    if roles == _applied_roles:
        return False
    _applied_roles = roles
    init_llm(models=build_llm_models(roles), default_model=DEFAULT_LLM_MODEL)
    logger.info("LLM 모델 재적용: %s", roles)
    return True
```

`app.py` 는 지금 `graph` 만 들고 있으므로 모듈도 같이 보관한 뒤 요청 진입부에서 부른다:

```python
# discover_and_load_workflows() 안
workflow_graphs[version] = graph
workflow_modules[version] = module          # ← 추가

# completion() 진입부
module = workflow_modules.get(version)
if module is not None:
    getattr(module, "sync_llm_models", lambda: None)()
```

`v1_0` 과 `v1_1` 은 구조가 같고 **모듈이 서로 다르다.** 두 버전을 다 쓰면 양쪽에 같은 작업을
하고, 리로드도 요청이 온 버전의 모듈에 대해 각각 불러야 한다.

---

## 5. 검증

단계별로 끊어서 확인한다. 한 번에 다 붙이고 "왜 안 되지"를 하면 원인 후보가 너무 많다.

1. **loader 단독** — 파이썬 셸에서 `load_model_roles()` 가 4행을 dict 로 돌려주는지.
   빈 dict 면 DB 접속·GRANT·DSN 중 하나다 (경고 로그에 원인이 찍힌다).
2. **조립** — `build_llm_models(load_model_roles())` 결과의 `.model` 이 PTX 에 넣은
   모델명인지. `MODEL_NM` 을 비워두면 기존 모델명이 나와야 한다.
3. **기동** — 에이전트를 띄우고 `LLM 초기화 완료: [...]` 로그를 본다.
4. **실제 호출** — `core/llm.py` 의 `LLM 모델 생성: {name} ({config.model})` 로그가
   바뀐 모델명으로 찍히는지. **이 로그가 안 찍히면 캐시가 안 비워진 것이다 (Step 4).**
5. **무재기동 반영** — PTX `/models` 에서 모델명을 바꾸고 저장 → 질문 한 번 → 4번 로그가
   새 이름으로 다시 찍히는지.
6. **DB 차단 시** — DSN 을 일부러 틀리게 하고 에이전트가 **경고만 남기고 정상 기동**하는지.

---

## 6. 실패 모드

| 증상 | 원인 | 확인 |
|---|---|---|
| PTX 에서 바꿔도 계속 옛 모델 | `lru_cache` 미소거 | Step 4 |
| 특정 role 만 반영 안 됨 | `ROLE_CD` ≠ enum value | `SELECT ROLE_CD FROM PTX_MODEL_MAS` 와 `[e.value for e in LLMModel]` 비교 |
| 전부 기본값 | 조회 실패 | `PTX_MODEL_MAS 조회 실패` 경고 로그 |
| 기동 실패 | DSN 빈 값으로 `initialize()` | Step 1 의 가드 |
| temperature 가 안 먹음 | `TEMPERATURE` NULL | 의도된 동작 — NULL 은 기본값 유지 |
| 운영 트래픽까지 모델이 바뀜 | **의도된 동작** | 아래 참조 |

> **범위에 대한 주의.** 이 연동에는 프롬프트 쪽 `ACTIVE_YN` 같은 "테스트 중에만" 게이트가
> 없다. `PTX_MODEL_MAS` 를 바꾸면 그 프로세스의 **모든 호출**이 바뀐 모델로 나간다. 테스트
> 전용으로 쓰려면 PTX 와 물린 에이전트를 테스트 인스턴스로 분리하거나, role 별 게이트를
> 따로 설계해야 한다. 지금 구조에서 이건 "테스트 인스턴스의 모델 스위치"이지
> "운영과 격리된 A/B" 가 아니다.

---

## 7. 체크리스트

- [ ] `LLMModel` enum value ↔ `PTX_MODEL_MAS.ROLE_CD` 일치
- [ ] `GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>`
- [ ] 에이전트 DSN = PTX DSN (같은 DB)
- [ ] `OracleDBManager.initialize()` — DSN 없을 때 가드 포함
- [ ] `config/model_roles.py` 추가 — 예외를 밖으로 던지지 않음
- [ ] `settings.py` — `build_llm_models(overrides)` 로 교체, `_FALLBACK_MODEL_NM` 채움
- [ ] `core/llm.py` — `initialize()` 에 `cache_clear()` 추가
- [ ] `workflow.py` — `sync_llm_models()` 추가
- [ ] `app.py` — 요청 진입부에서 호출, `workflow_modules` 보관
- [ ] `v1_0` / `v1_1` 양쪽 적용
- [ ] 검증 1~6 통과

## 8. 롤백

`settings.py` 의 `LLM_MODELS = build_llm_models(load_model_roles())` 를
`build_llm_models()` (인자 없이) 로 바꾸면 즉시 config 기본값만 쓰는 원래 동작으로
돌아간다. DB·테이블·화면은 그대로 둬도 무해하다.
