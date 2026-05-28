# 운영 연동 체크리스트 (CHAT_VER_MAS / NODE_MAS 기반)

이 문서는 프롬프트 관리 시스템을 **기존(운영) LangGraph 프로젝트**와 연결할 때, 내가(운영 담당자가)
내부망에서 직접 채워야 하는 부분을 정리한 것이다. 데모(로컬 Oracle)는 이미 동작하도록 시드해 두었다.

## 0. 아키텍처 요약

- **단일 플로우.** 프로젝트 선택 화면 없음. 첫 화면은 **RAGAS 회귀 평가** 화면(`/`).
- **고정 테이블 2개 (구조 변경 금지)** — 운영 프로젝트 소유, PM은 데이터만 읽고/일부 기록:
  - `CHAT_VER_MAS` : 현재 플로우 1행. 사용 컬럼 `ID`, `MAIN_MODEL_NM`. (`GRAPH_STRUCT`는 더 이상 표출하지 않음)
  - `NODE_MAS` : 현재 노드들. 사용 컬럼 `ID`, `CHAT_VER_ID`, `NODE_NM`, `NODE_DESC`,
    `PROMPT`, `PROMPT_EDIT_ENABLE_YN`, `UPDATE_DATE`. (`PROMPT_EDIT_ENABLE_YN='Y'` = 프롬프트(LLM) 노드)
- **PM_* 테이블 (6개)** : 같은 Oracle DB에 존재.
  - `PM_NODE_PROMPT_VER`(노드 프롬프트 버전 — `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리),
    `PM_TEST_DATASET`/`PM_TEST_CASE`(RAGAS 데이터셋), `PM_RAGAS_RUN`/`PM_RAGAS_RESULT`, `PM_AUDIT_LOG`.
  - `PM_TEST_RUN`/`PM_TEST_RESULT`(비-RAGAS 테스트)·`PM_FLOW_VER`/`PM_FLOW_VER_NODE`(플로우 버전 이력)는
    RAGAS 중심 전환 때 **삭제**됨(alembic `0008`).
- **ACTIVATE** : 웹에서 노드 프롬프트 버전을 활성화하면 → ① PM 활성 플래그 전환 → ② **`SYSTEM_PROMPT` 를
  단일 `NODE_MAS.PROMPT` 컬럼에 기록**(+`UPDATE_DATE`, 운영 반영. `USER_PROMPT` 는 테스트 메시지
  템플릿으로 PM 에만 보관). (플로우 버전 스냅샷 단계는 폐지)
- **RAGAS 평가(유일한 테스트 경로)** : 데이터셋 각 케이스를 **전체 플로우**에 보내 답을 받고 RAGAS로 채점.
  답 생성은 `RUN_MODE=external` 이면 내부 모델 채팅 엔드포인트(`EXTERNAL_CHAT_PATH`) 호출, 기본
  `RUN_MODE=stub` 이면 임시 placeholder 답변. 채점은 judge 키가 있으면 실제 ragas, 없으면 fallback.

---

## 1. DB 접속 (`backend/.env`)

```
ORACLE_DSN=<user>/<password>@<host>:<port>/<service>   # 예: system/orcl@localhost:1521/orcl
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
- `NODE_MAS(ID, CHAT_VER_ID, NODE_NM, MODEL_NM, NODE_DESC, PROMPT, PROMPT_EDIT_ENABLE_YN,
  MODEL_EDIT_ENABLE_YN, MAIN_MODEL_EDIT_ENABLE_YN, CREATE_DATE, UPDATE_DATE, CREATE_USER, UPDATE_USER)`

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
EXTERNAL_CHAT_TYPE=default
EXTERNAL_USER_ID=pm-test
# EXTERNAL_IS_SUPER_AGENT=true
# EXTERNAL_A2A_REMOTE_URLS=http://a,http://b   # 콤마구분 → 리스트, 미설정 → null
```
내부 모델이 받는 요청 (`backend/app/services/external_agent.py:run_flow` 이 전송):
```
POST {EXTERNAL_AGENT_BASE_URL}{EXTERNAL_CHAT_PATH}
요청 : {
  "message": "<테스트 입력>", "user_id": "pm-test", "session_id": "<uuid>",
  "chat_type": "default", "a2a_remote_urls": null, "is_super_agent": null,
  "main_model_name": "<플로우 메인 모델>", "session_system_prompt": "<활성 SYSTEM_PROMPT>"
}
응답 : {"output": "<답변>"}     # 답변 필드 자동 탐지(output/answer/response/message/...)
```
- `session_system_prompt` ← 활성 노드의 `SYSTEM_PROMPT`(= `NODE_MAS.PROMPT`). A·B 는 해당 플로우 버전의 것.
- `main_model_name` ← `CHAT_VER_MAS.MAIN_MODEL_NM`.  `message` ← 데이터셋 케이스 입력.
- 답변 필드가 다르면 `external_agent._ANSWER_KEYS` 에 추가. 모델이 여러 노드 시스템 프롬프트가 아닌
  **단일** 세션 프롬프트를 원하면 `flow_service._flow_session_system_prompt` 를 조정.

> 기본값 `RUN_MODE=stub` 에서는 RAGAS 평가가 임시 placeholder 답변으로 끝까지 동작한다(외부 미연결).
> 위처럼 `RUN_MODE=external` 로 바꾸면 실제 채팅 엔드포인트를 호출한다.
> 계약 확인: `.claude/skills/connect-prompt-mgmt/scripts/callback_probe.py --base-url <model> --path /chat`.

## 5. LLM provider (RAGAS judge 전용)

노드 단위 실행 경로는 제거됐다(전체 플로우 RAGAS만 남음). 이 시스템이 직접 호출하는 LLM은
**RAGAS 실제 엔진의 judge/임베딩 모델**뿐이며, 내부망에서는 `LLM_ENDPOINT`/`LLM_API_KEY`/`LLM_MODEL_NAME`
(OpenAI 호환 게이트웨이)로, 그 외에는 provider 키로 `.env` 에서 주입한다. judge 키가 없으면 fallback 채점기가
LLM 없이 동작한다. (답 생성은 외부 채팅 엔드포인트 또는 stub 이 담당하므로 모델명 provider 추론과 무관.)

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

## 7. 데모 시드 스크립트 (로컬 Oracle 전용)

- `backend/scripts/demo_seed_oracle.py` — `CHAT_VER_MAS`/`NODE_MAS` 데모 테이블 생성 + RAG 플로우 시드.
  (운영에서는 실행하지 말 것 — 실제 테이블이 이미 존재.)
- `backend/scripts/seed_pm_demo.py` — `alembic upgrade head` 후 `NODE_MAS` 로부터 노드 프롬프트
  v1.0.0(활성)을 `PM_NODE_PROMPT_VER` 에 시드. (플로우 버전 시드는 폐지)
- `backend/scripts/demo_seed_oracle.sql` — 위 DDL/시드의 sqlplus 버전.

## 8. 빠른 점검

```
GET  /api/v1/flow/current                 # 노드 목록(+has_prompt) ← 프롬프트 관리 진입
GET  /api/v1/nodes/{id}/prompts            # 노드 프롬프트 버전 목록
POST /api/v1/nodes/{id}/prompts            # 새 버전
PUT  /api/v1/prompts/{pid}                 # 비활성 버전 프롬프트 편집(활성은 잠금)
PUT  /api/v1/prompts/{pid}/activate        # 활성화 → NODE_MAS.PROMPT 기록
GET  /api/v1/nodes/{id}/audit-logs         # 노드 프롬프트 변경 이력
GET/POST /api/v1/flow/datasets             # RAGAS 데이터셋(scope='FLOW')
POST /api/v1/flow/test/ragas               # 전체 플로우 RAGAS 평가(유일한 테스트 경로)
GET  /api/v1/ragas-runs · /ragas-runs/{id} · DELETE /ragas-runs/{id}
GET  /api/v1/ragas-runs/{id}/export?fmt=csv|xlsx
```

> 프롬프트는 `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리, 활성화 시 `SYSTEM_PROMPT`만 `NODE_MAS.PROMPT` 로 반영(`0006`).
> RAGAS 중심 전환(`0008`)으로 단건/일괄/A·B 테스트·플로우 버전 이력·메인 모델 변경 기능과 관련 테이블
> (`PM_TEST_RUN`/`PM_TEST_RESULT`/`PM_FLOW_VER`/`PM_FLOW_VER_NODE`) 및 사장 컬럼
> (`PM_RAGAS_RUN.NODE_MAS_ID/PROMPT_ID`, `PM_NODE_PROMPT_VER` 모델 파라미터)이 제거됐다. RAGAS는 **전체 플로우** 단위로만 실행한다.
