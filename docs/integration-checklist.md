# 운영 연동 체크리스트 (CHAT_VER_MAS / NODE_MAS 기반)

이 문서는 프롬프트 관리 시스템을 **기존(운영) LangGraph 프로젝트**와 연결할 때, 내가(운영 담당자가)
내부망에서 직접 채워야 하는 부분을 정리한 것이다. 데모(로컬 Oracle)는 이미 동작하도록 시드해 두었다.

## 0. 아키텍처 요약

- **단일 플로우.** 프로젝트 선택 화면 없음. 첫 화면은 **RAGAS 회귀 평가** 화면(`/`).
- **고정 테이블 2개 (구조 변경 금지)** — 운영 프로젝트 소유, PM은 노드 메타만 읽음:
  - `CHAT_VER_MAS` : 현재 플로우 1행. PM 은 `ID` 만 사용 (`MAIN_MODEL_NM` / `GRAPH_STRUCT` 는 미사용).
  - `NODE_MAS` : 현재 노드들. PM 은 노드 메타 (`ID`, `CHAT_VER_ID`, `NODE_NM`, `NODE_DESC`,
    `PROMPT_EDIT_ENABLE_YN`) 만 읽음. **`PROMPT` 컬럼은 PM/외부 모델 어디서도 안 읽음**(미러링은 vestigial — 외부 모델은 `PM_NODE_PROMPT_VER` 만 봄).
- **PM_* 테이블 (6개)** : 같은 Oracle DB에 존재.
  - `PM_NODE_PROMPT_VER`(노드 프롬프트 버전 — `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리),
    `PM_TEST_DATASET`/`PM_TEST_CASE`(RAGAS 데이터셋), `PM_RAGAS_RUN`/`PM_RAGAS_RESULT`, `PM_AUDIT_LOG`.
  - `PM_TEST_RUN`/`PM_TEST_RESULT`(비-RAGAS 테스트)·`PM_FLOW_VER`/`PM_FLOW_VER_NODE`(플로우 버전 이력)는
    RAGAS 중심 전환 때 **삭제**됨(alembic `0008`).
- **ACTIVATE** : 웹에서 노드 프롬프트 버전을 활성화하면 → ① `PM_NODE_PROMPT_VER.IS_ACTIVE` 플래그 전환
  (해당 노드 1행만 'Y') → ② `NODE_MAS.PROMPT` / `UPDATE_DATE` 미러링은 현재 코드가 같이 하지만 외부
  모델이 더 이상 안 읽으므로 vestigial. 외부 모델은 `PM_NODE_PROMPT_VER` 의 active row 만 본다.
- **A·B RAGAS** : 평가 도중에만 PM 이 `IS_ACTIVE` 를 일시 토글해 외부 모델이 비활성 버전의 프롬프트를
  읽게 하고, 끝나면 `finally` 에서 원래 active 로 복구한다 (`flow_service._swap_active_prompt` /
  `_restore_active_prompt`). 외부 모델 측 로더는 캐시를 짧게 두거나 매 호출 시 재조회해야 토글이 반영된다.
- **RAGAS 평가(유일한 테스트 경로)** : 데이터셋 각 케이스를 **전체 플로우**에 보내 답을 받고 RAGAS로 채점.
  답 생성은 `RUN_MODE=external` 이면 내부 모델 채팅 엔드포인트(`EXTERNAL_CHAT_PATH`) 호출, 기본
  `RUN_MODE=stub` 이면 임시 placeholder 답변. 채점은 judge 키가 있으면 실제 ragas, 없으면 fallback.

---

## 1. DB 접속 (`backend/.env`)

user/password/dsn 3개를 따로 적는다. `ORACLE_DSN` 은 python-oracledb 에 그대로 넘기는
bare 연결 문자열 — Easy Connect / tnsnames alias / 풀 TNS descriptor 다 가능.
```
ORACLE_USER=<user>
ORACLE_PASSWORD=<password>
# 둘 중 한 형식 (한 줄, 따옴표 없이):
ORACLE_DSN=host:port/service_name
ORACLE_DSN=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...)))(CONNECT_DATA=(SERVICE_NAME=...)))
```

스키마 생성(최초 1회): `backend/` 에서
```
.venv\Scripts\python.exe -m alembic upgrade head
```
> 마이그레이션 체인은 `0001 … 0007` 다음 **`0008`(RAGAS 중심 정리: `PM_TEST_RUN`/`PM_TEST_RESULT`·
> `PM_FLOW_VER`/`PM_FLOW_VER_NODE` 드롭 + 사장된 컬럼 정리)** 로 끝난다.
> **`CHAT_VER_MAS`/`NODE_MAS`/`MODEL_MAS` 는 생성/변경하지 않는다**(운영에 이미 존재한다고 가정).
> 이미 `0007` 상태인 DB라면 `alembic upgrade head` 가 `0008`만 적용한다(스탬프가 없으면 `alembic stamp 0007` 후 실행).

## 2. 고정 테이블 컬럼 확인 (코드가 기대하는 이름)

실제 운영 테이블의 컬럼명이 아래와 정확히 일치하는지 확인한다. 다르면 모델 매핑
(`backend/app/models/chat_ver.py`, `backend/app/models/node_mas.py`)의 `mapped_column("<컬럼명>")` 만 맞춰준다.

- `CHAT_VER_MAS(ID, GRAPH_STRUCT, MAIN_MODEL_NM[, CREATE_DATE, UPDATE_DATE, CREATE_USER, UPDATE_USER])`
  ※ PM 은 `ID` 만 사용. 나머지 컬럼은 모델 매핑만 유지 (안 읽음).
- `NODE_MAS(ID, CHAT_VER_ID, NODE_NM, MODEL_NM, NODE_DESC, PROMPT, PROMPT_EDIT_ENABLE_YN,
  MODEL_EDIT_ENABLE_YN, MAIN_MODEL_EDIT_ENABLE_YN, CREATE_DATE, UPDATE_DATE, CREATE_USER, UPDATE_USER)`
  ※ PM 은 노드 메타 (ID/CHAT_VER_ID/NODE_NM/NODE_DESC/PROMPT_EDIT_ENABLE_YN) 만 읽음. `PROMPT` 는 vestigial.

## 3. 현재 플로우 식별 규칙  >>> FILL IN

`backend/app/services/flow_service.py` 의 `get_current_chat()` 는 데모상 **가장 큰 `CHAT_VER_MAS.ID`**
(최신 행)를 현재 플로우로 본다. 운영에서 "현재 활성 플로우"를 다른 규칙(별도 플래그/상태 컬럼 등)으로
정한다면 이 함수를 수정한다.

## 4. 전체 테스트 외부 계약 (내부 모델 채팅 엔드포인트)  >>> FILL IN

`backend/.env`:
```
RUN_MODE=external
EXTERNAL_AGENT_BASE_URL=http://<model-host>:<port>
EXTERNAL_CHAT_PATH=/chat                  # 내부 모델의 실제 채팅 경로
EXTERNAL_USER_ID=pm-test
```
내부 모델이 받는 요청 (`backend/app/services/external_agent.py:run_flow` 이 전송):
```
POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}
요청 : { "message": "<테스트 입력>", "user_id": "pm-test" }
응답 : {
  "response": "<답변>",
  "service_id": "...", "session_id": "...", "user_id": "...", "trace_id": "...",
  "docs": [...], "urls": [], "images": [], "db_data": [],
  "followup_questions": [], "knowhows": []
}
```
- 백엔드는 `response` (답변) 와 `docs` (RAGAS retrieved contexts — 데이터셋 케이스에 `contexts` 가 비었을 때만 사용) 만 읽고, 나머지 필드는 받아도 무시한다.
- 내부 모델은 자기 노드별 `SYSTEM_PROMPT`/`USER_PROMPT` 를 **공유 Oracle DB 의 `PM_NODE_PROMPT_VER` active row 에서 직접 로드**한다. 요청 페이로드엔 프롬프트가 실리지 않는다.
- **A·B RAGAS 동안엔 PM 이 `IS_ACTIVE` 를 일시 토글**한다. 모델 측 로더는 캐시 TTL 을 짧게 두거나 매 호출 재조회해야 토글이 반영된다.

> 기본값 `RUN_MODE=stub` 에서는 RAGAS 평가가 임시 placeholder 답변으로 끝까지 동작한다(외부 미연결).
> 위처럼 `RUN_MODE=external` 로 바꾸면 실제 채팅 엔드포인트를 호출한다.
> 계약 확인: `.claude/skills/connect-prompt-mgmt/scripts/callback_probe.py --base-url <model> --path /chat`.

## 5. LLM provider (RAGAS judge 전용)

이 시스템이 직접 호출하는 LLM 은 **RAGAS judge / embedding 모델**뿐이고, 둘 다 OpenAI 호환
게이트웨이로 보낸다 (judge 와 embedding 은 다른 게이트웨이여도 됨). `.env`:
```
LLM_ENDPOINT=http://<gateway>:<port>/v1
LLM_API_KEY=<key>
LLM_MODEL_NAME=<judge chat model>

EMBEDDING_ENDPOINT=http://<embedding-gateway>:<port>/v1   # context_precision/recall 필요시
EMBEDDING_API_KEY=<key>
EMBEDDING_MODEL_NAME=<embedding model>
```
`LLM_ENDPOINT` 가 비어있으면 자동으로 fallback 채점기 (LLM 미호출, 토큰 겹침 휴리스틱) 로 떨어진다.
`EMBEDDING_ENDPOINT` 가 비어있으면 LLM-only metrics (faithfulness / answer_relevancy 등) 만 동작하고
context_precision / context_recall 은 skip 된다.
답 생성은 외부 채팅 엔드포인트 (또는 stub) 가 담당하므로 이 LLM 설정과 무관하다.

## 6. 실행 방법

**백엔드** (`backend/`):
```
.venv\Scripts\activate
uvicorn app.main:app --reload --port 8000      # Oracle 사용 (.env). 테스트 시에만 APP_ENV=test → SQLite
```
**프론트엔드** (`frontend/`):
```
npm install            # mermaid 등 의존성 설치
npm run dev            # http://localhost:3000
```
프론트가 다른 호스트의 API 를 보게 하려면 `frontend/.env.local` 에
`NEXT_PUBLIC_API_BASE_URL=http://<host>:8000/api/v1`.

## 7. 빠른 점검

```
GET  /api/v1/flow/current                 # 노드 목록(+has_prompt) ← 프롬프트 관리 진입
GET  /api/v1/nodes/{id}/prompts            # 노드 프롬프트 버전 목록
POST /api/v1/nodes/{id}/prompts            # 새 버전
PUT  /api/v1/prompts/{pid}                 # 비활성 버전 프롬프트 편집(활성은 잠금)
PUT  /api/v1/prompts/{pid}/activate        # 활성화 → NODE_MAS.PROMPT 기록
GET  /api/v1/nodes/{id}/audit-logs         # 노드 프롬프트 변경 이력
GET/POST /api/v1/flow/datasets             # RAGAS 데이터셋(scope='FLOW')
POST /api/v1/flow/test/ragas               # 전체 플로우 RAGAS 평가
POST /api/v1/flow/test/ragas/ab            # A·B 버전 비교 RAGAS (IS_ACTIVE 일시 토글)
GET  /api/v1/ragas-runs · /ragas-runs/{id} · DELETE /ragas-runs/{id}
GET  /api/v1/ragas-runs/{id}/export?fmt=csv|xlsx
GET  /api/v1/ragas-runs/ab/{ab_group_id}/export?fmt=csv|xlsx
```

> 프롬프트는 `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리, 활성화 시 `SYSTEM_PROMPT`만 `NODE_MAS.PROMPT` 로 반영(`0006`).
> RAGAS 중심 전환(`0008`)으로 단건/일괄/A·B 테스트·플로우 버전 이력·메인 모델 변경 기능과 관련 테이블
> (`PM_TEST_RUN`/`PM_TEST_RESULT`/`PM_FLOW_VER`/`PM_FLOW_VER_NODE`) 및 사장 컬럼
> (`PM_RAGAS_RUN.NODE_MAS_ID/PROMPT_ID`, `PM_NODE_PROMPT_VER` 모델 파라미터)이 제거됐다. RAGAS는 **전체 플로우** 단위로만 실행한다.
