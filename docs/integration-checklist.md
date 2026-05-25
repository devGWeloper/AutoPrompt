# 운영 연동 체크리스트 (CHAT_VER_MAS / NODE_MAS 기반)

이 문서는 프롬프트 관리 시스템을 **기존(운영) LangGraph 프로젝트**와 연결할 때, 내가(운영 담당자가)
내부망에서 직접 채워야 하는 부분을 정리한 것이다. 데모(로컬 Oracle)는 이미 동작하도록 시드해 두었다.

## 0. 아키텍처 요약

- **단일 플로우.** 프로젝트 선택 화면 없음. 첫 화면이 바로 `CHAT_VER_MAS.GRAPH_STRUCT`(머메이드) 그래프.
- **고정 테이블 2개 (구조 변경 금지)** — 운영 프로젝트 소유, PM은 데이터만 읽고/일부 기록:
  - `CHAT_VER_MAS` : 현재 플로우 1행. 사용 컬럼 `ID`, `GRAPH_STRUCT`, `MAIN_MODEL_NM`.
  - `NODE_MAS` : 현재 노드들. 사용 컬럼 `ID`, `CHAT_VER_ID`, `NODE_NM`, `MODEL_NM`, `NODE_DESC`,
    `PROMPT`, `PROMPT_EDIT_ENABLE_YN`, `UPDATE_DATE`. (`PROMPT_EDIT_ENABLE_YN='Y'` = 프롬프트(LLM) 노드)
- **PM_* 테이블** : 버전/이력/스냅샷/테스트/감사. 같은 Oracle DB에 존재.
  - `PM_NODE_PROMPT_VER`(노드 프롬프트 버전 — `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리),
    `PM_FLOW_VER`/`PM_FLOW_VER_NODE`(전체 플로우 버전+매니페스트), `PM_TEST_*`, `PM_RAGAS_*`, `PM_AUDIT_LOG`.
- **ACTIVATE** : 웹에서 노드 프롬프트 버전을 활성화하면 → ① PM 활성 플래그 전환 → ② **`SYSTEM_PROMPT` 를
  단일 `NODE_MAS.PROMPT` 컬럼에 기록**(+`UPDATE_DATE`, 운영 반영. `USER_PROMPT` 는 테스트 메시지
  템플릿으로 PM 에만 보관) → ③ 전체 플로우 버전 1단계 상승(`PM_FLOW_VER` 스냅샷).
- **전체 테스트** : 내부 모델의 **단일 채팅 엔드포인트**(`EXTERNAL_CHAT_PATH`)를 호출. 관리 중인
  시스템 프롬프트를 `session_system_prompt` 로 실어 보내고 응답(답변)을 표시.

---

## 1. DB 접속 (`backend/.env`)

```
ORACLE_DSN=<user>/<password>@<host>:<port>/<service>   # 예: system/orcl@localhost:1521/orcl
```

스키마 생성(최초 1회): `backend/` 에서
```
.venv\Scripts\python.exe -m alembic upgrade head
```
> alembic 마이그레이션 `0004` 는 옛 프로젝트 중심 PM_* 를 드롭하고 새 PM_* 를 만든다.
> **`CHAT_VER_MAS`/`NODE_MAS` 는 생성/변경하지 않는다**(운영에 이미 존재한다고 가정).

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

> `RUN_MODE=internal`(기본)에서는 전체 테스트가 "external 모드 필요"로 실패한다 — 의도된 동작.
> 계약 확인: `.claude/skills/connect-prompt-mgmt/scripts/callback_probe.py --base-url <model> --path /chat`.

## 5. 모델 → provider 매핑 (노드 단건 테스트/RAGAS용)

`NODE_MAS`/`PM_NODE_PROMPT_VER` 에는 모델 **이름만** 있어 provider 를 이름으로 추론한다
(`backend/app/services/llm/__init__.py:provider_for_model`, 접두사 claude*/gpt*/gemini* 등).
운영에서 다른 모델명을 쓰면 `_MODEL_PREFIX_PROVIDER` 에 추가한다. (전체 테스트는 외부가 처리하므로 무관.)

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
- `backend/scripts/seed_pm_demo.py` — `alembic upgrade head` 후 PM_* 에 노드 프롬프트 v1.0.0(활성) +
  플로우 v1.0.0 을 `NODE_MAS` 로부터 시드.
- `backend/scripts/demo_seed_oracle.sql` — 위 DDL/시드의 sqlplus 버전.

## 8. 빠른 점검

```
GET  /api/v1/flow/current                 # 머메이드 + 노드(+has_prompt) + flow_version_no
GET  /api/v1/nodes/{id}/prompts            # 노드 프롬프트 버전 목록
POST /api/v1/nodes/{id}/prompts            # 새 버전
PUT  /api/v1/prompts/{pid}/activate        # 활성화 → NODE_MAS.PROMPT 기록 + 플로우 버전 ↑
GET  /api/v1/flow/versions                 # 전체 플로우 버전 이력
GET  /api/v1/flow/models                   # MODEL_MAS.GAIA_MODEL_NM 목록(메인 모델 선택)
PUT  /api/v1/flow/main-model               # 메인 모델 변경 → CHAT_VER_MAS.MAIN_MODEL_NM + 새 플로우 버전
PUT  /api/v1/prompts/{pid}                 # 비활성 버전 프롬프트 편집(활성은 잠금)
GET/POST /api/v1/flow/datasets             # 플로우 데이터셋(scope='FLOW')
POST /api/v1/flow/test/run|batch|ab|ragas  # 전체 플로우 테스트(내부 모델 채팅). ab=두 버전(시스템프롬프트/모델)
GET  /api/v1/test-runs                      # 테스트 기록 전체  /  DELETE /test-runs/{id} 삭제
```

> 2~4차 추가: 모델은 **메인 모델 1개**만 `MODEL_MAS`에서 선택(노드별 모델 수정 불가, `MODEL_EDIT_ENABLE_YN`=N),
> 변경 시 새 플로우 버전. 비활성 버전만 프롬프트 in-place 편집. 배치/A·B/RAGAS는 **전체 플로우**를 내부 모델
> 채팅 엔드포인트로 실행(A·B는 두 플로우 버전 비교 — 버전별 `session_system_prompt`/`main_model_name` 전달).
> 프롬프트는 `SYSTEM_PROMPT`/`USER_PROMPT` 2컬럼 분리, 활성화 시 `SYSTEM_PROMPT`만 `NODE_MAS.PROMPT` 로 반영(`0006`).
> 플로우 RAGAS 위해 `PM_RAGAS_RUN.NODE_MAS_ID/PROMPT_ID` nullable(`0005`).
