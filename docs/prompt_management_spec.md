# AI Agent 프롬프트 관리 시스템 기능 명세서

**프로젝트명:** AI Agent Prompt Management System  
**버전:** v1.0.0  
**작성일:** 2026-05-15  
**기술 스택:** Next.js (Frontend) / Python FastAPI (Backend) / Oracle DB

---

## 구현 현황 / 명세 대비 편차 (2026-05-19 기준)

> 본 문서는 원본 요구사항 기준선이며, 일부 항목은 구현 과정에서 변경됐다.
> 아래가 **현재 코드 기준 사실**이며 충돌 시 이 절이 우선한다.

- **인증/로그인/PM_USER 전면 제거** — 사내 단일 신뢰 환경. 모든 API 공개,
  생성자/감사 주체는 `SYSTEM_USER`("system") 단일.
- **모델 설정 = 프롬프트 버전 내장** — 별도 `PM_MODEL_CONFIG` 엔티티 **미구현**.
  `PM_PROMPT_VERSION`에 `MODEL_PROVIDER/MODEL_NM/TEMPERATURE/MAX_TOKENS/
  TOP_P/EXTRA_PARAMS` 컬럼으로 종속. (본문 §3 DDL의 PM_MODEL_CONFIG·CONFIG_ID는
  미반영 — 편차 주석 참조.)
- **PM_TEST_CASE.CASE_NM 제거** — 케이스 식별은 `CASE_ID`. CSV 업로드 컬럼:
  `input_json, expected_output, eval_criteria, case_type`.
- **RAGAS(§4.6)** — 플러그형: 실제 `ragas` + 결정론 로컬 폴백. Judge 키는
  `.env`의 첫 provider 키 자동감지(openai>anthropic>google),
  `RAGAS_ENGINE=auto|fallback|ragas`. `PM_RAGAS_RUN` 확장 + `PM_RAGAS_RESULT`
  (alembic `0002`).
- **결과 내보내기** — CSV / Excel(openpyxl)만. **PDF 미지원**.
- **의존성** — 단일 `backend/requirements.txt`(runtime+dev+ragas).
  `pyproject.toml`은 ruff/pytest 설정만.
- **마이그레이션 체인** — `0001 → 0002(RAGAS) → 0003(CASE_NM 제거)`.
- **미구현(후속)** — 외부 LangGraph Agent 호출 어댑터
  (`app/services/external_agent.py` 없음, 플로우 실행은 시스템 내부 한정),
  프롬프트 로컬 캐시(§6.3), LLM 비용 추정.

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [아키텍처 설계](#2-아키텍처-설계)
3. [데이터베이스 스키마](#3-데이터베이스-스키마)
4. [화면 및 기능 명세](#4-화면-및-기능-명세)
   - 4.1 메인 화면 (그래프 뷰)
   - 4.2 프롬프트 관리 화면
   - 4.3 모델 관리 화면
   - 4.4 노드 단위 테스트 화면
   - 4.5 전체 플로우 테스트 화면
   - 4.6 RAGAS 평가 화면
   - 4.7 히스토리 / 변경 이력 화면
5. [API 명세 (FastAPI)](#5-api-명세)
6. [비기능 요구사항](#6-비기능-요구사항)

---

## 1. 시스템 개요

### 1.1 목적

AI Agent 프로젝트를 구성하는 LangGraph 기반 각 노드(Node)의 **프롬프트**와 **LLM 모델 설정**을 중앙에서 버전 관리하고, 코드 배포 없이 프롬프트를 수정·검증·배포할 수 있는 웹 기반 관리 시스템을 제공한다.

### 1.2 배경 및 필요성

- 다수의 노드로 구성된 AI Agent에서 프롬프트가 소스 코드에 하드코딩되어 변경 추적이 불가능한 상황
- 노드마다 사용하는 LLM 모델(Claude, GPT-4o, Gemini 등)이 다르며, 모델 변경 시 영향 범위 파악 어려움
- 프롬프트 수정 시 회귀 테스트(Regression Test) 및 RAGAS 평가 체계 부재
- 변경 이력(누가, 언제, 왜 수정했는지) 추적 불가

### 1.3 용어 정의

| 용어 | 설명 |
|------|------|
| Node | LangGraph 기반 AI Agent를 구성하는 처리 단위 (예: 분류기, 응답 생성기) |
| Prompt Version | 특정 노드에 적용된 프롬프트의 스냅샷 (불변) |
| Model Config | LLM 호출 시 사용하는 모델명, temperature, max_tokens 등의 설정 묶음 |
| Active Version | 현재 프로덕션에서 실제 사용 중인 프롬프트 버전 |
| Golden Dataset | 회귀 테스트 및 RAGAS 평가에 사용하는 입력-기대값 쌍의 집합 |
| RAGAS | Retrieval-Augmented Generation Assessment System - RAG 품질 자동 평가 프레임워크 |

---

## 2. 아키텍처 설계

### 2.1 전체 구조

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js Frontend                       │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 그래프뷰  │ │프롬프트관리│ │  테스트  │ │ RAGAS평가│  │
│  └──────────┘ └────────────┘ └──────────┘ └──────────┘  │
└──────────────────────┬───────────────────────────────────┘
                       │ REST API / WebSocket
┌──────────────────────▼───────────────────────────────────┐
│                  Python FastAPI Backend                    │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Node API │ │Prompt API  │ │ Test API │ │RAGAS API │  │
│  └──────────┘ └────────────┘ └──────────┘ └──────────┘  │
│                       │                                   │
│              ┌─────────▼──────────┐                      │
│              │   Oracle DB (via   │                      │
│              │   cx_Oracle/ORM)   │                      │
│              └────────────────────┘                      │
└───────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│              External LLM APIs                            │
│        (Claude / OpenAI / Gemini / etc.)                  │
└───────────────────────────────────────────────────────────┘
```

### 2.2 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| Frontend | Next.js 14+ (App Router) | TypeScript, Tailwind CSS |
| 그래프 시각화 | React Flow | LangGraph 구조를 시각화 |
| Backend | Python 3.11+ / FastAPI | Pydantic v2, async |
| ORM | SQLAlchemy 2.0 | Oracle 연결 |
| Oracle Driver | cx_Oracle / python-oracledb | |
| LLM SDK | anthropic, openai, google-generativeai | |
| RAGAS 평가 | ragas 라이브러리 | |
| 인증 | 없음 (사내 단일 신뢰 환경) | 로그인/JWT 전면 제거됨 |
| 실시간 통신 | WebSocket (FastAPI) | 테스트 결과 스트리밍 |

---

## 3. 데이터베이스 스키마

### 3.1 테이블 목록

> ⚠️ 아래 §3.1/§3.2 는 **최초 명세안(다중 프로젝트)** 이다. 구현은 단일 플로우
> (`CHAT_VER_MAS`/`NODE_MAS`) 구조로 리팩터링됐고(`alembic 0004`), 이어 **RAGAS 중심으로 정리**됐다
> (`alembic 0008`). **현행 권위 스키마는 [`backend/sql/ddl_initial.sql`](./backend/sql/ddl_initial.sql)
> + `backend/app/models/*`** 를 본다. 현재 PM 소유 테이블은 **6개**: `PM_NODE_PROMPT_VER`,
> `PM_TEST_DATASET`, `PM_TEST_CASE`, `PM_RAGAS_RUN`, `PM_RAGAS_RESULT`, `PM_AUDIT_LOG`.

```
PM_PROJECT          - (제거) 다중 프로젝트 구조 폐지 → 단일 플로우 CHAT_VER_MAS
PM_NODE             - (제거) → 운영 고정 테이블 NODE_MAS 사용
PM_NODE_EDGE        - (제거)
PM_MODEL_CONFIG     - (제거) 모델 설정 기능 폐지
PM_PROMPT_VERSION   - → PM_NODE_PROMPT_VER (NODE_MAS_ID 기준, SYSTEM_PROMPT/USER_PROMPT 분리)
PM_PROMPT_VARIABLE  - (제거)
PM_TEST_DATASET     - 골든 데이터셋 (RAGAS) — 유지
PM_TEST_CASE        - 테스트 케이스 (question/contexts/ground_truth) — 유지
PM_TEST_RUN         - (제거, 0008) 비-RAGAS 테스트 실행 기록
PM_TEST_RESULT      - (제거, 0008) 비-RAGAS 테스트 결과
PM_FLOW_VER         - (제거, 0008) 전체 플로우 버전 이력
PM_FLOW_VER_NODE    - (제거, 0008) 플로우 버전 매니페스트
PM_RAGAS_RUN        - RAGAS 평가 실행 (전체 플로우 단위) — 유지
PM_RAGAS_RESULT     - RAGAS 평가 결과 (지표별) — 유지
PM_AUDIT_LOG        - 변경 이력 감사 로그 — 유지
```

### 3.2 주요 테이블 DDL

```sql
-- 프로젝트
CREATE TABLE PM_PROJECT (
    PROJECT_ID      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROJECT_NM      VARCHAR2(100) NOT NULL,
    DESCRIPTION     VARCHAR2(500),
    STATUS          VARCHAR2(20) DEFAULT 'ACTIVE',  -- ACTIVE / ARCHIVED
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP,
    UPDATED_BY      VARCHAR2(50),
    UPDATED_DT      TIMESTAMP
);

-- 노드
CREATE TABLE PM_NODE (
    NODE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROJECT_ID      NUMBER NOT NULL REFERENCES PM_PROJECT(PROJECT_ID),
    NODE_KEY        VARCHAR2(100) NOT NULL,   -- 코드에서 참조하는 고유 키 (예: intent_classifier)
    NODE_NM         VARCHAR2(200) NOT NULL,
    NODE_TYPE       VARCHAR2(50),             -- LLM / TOOL / ROUTER / etc.
    POS_X           NUMBER,                   -- 그래프 X 좌표
    POS_Y           NUMBER,                   -- 그래프 Y 좌표
    DESCRIPTION     VARCHAR2(1000),
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP,
    UNIQUE (PROJECT_ID, NODE_KEY)
);

-- 노드 간 엣지 (연결)
CREATE TABLE PM_NODE_EDGE (
    EDGE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROJECT_ID      NUMBER NOT NULL REFERENCES PM_PROJECT(PROJECT_ID),
    SOURCE_NODE_ID  NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    TARGET_NODE_ID  NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    LABEL           VARCHAR2(100),
    CONDITION       VARCHAR2(500)             -- 조건부 라우팅 조건식
);

-- LLM 모델 설정 (버전 관리)
-- ※ 편차: 이 테이블은 구현되지 않음. 모델 설정은 PM_PROMPT_VERSION 컬럼
--   (MODEL_PROVIDER/MODEL_NM/TEMPERATURE/MAX_TOKENS/TOP_P/EXTRA_PARAMS)에 내장.
CREATE TABLE PM_MODEL_CONFIG (
    CONFIG_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_ID         NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    VERSION_NO      VARCHAR2(20) NOT NULL,    -- 예: 1.0, 1.1, 2.0
    MODEL_PROVIDER  VARCHAR2(50) NOT NULL,    -- anthropic / openai / google
    MODEL_NM        VARCHAR2(100) NOT NULL,   -- claude-3-5-sonnet, gpt-4o, etc.
    TEMPERATURE     NUMBER(3,2) DEFAULT 0.7,
    MAX_TOKENS      NUMBER DEFAULT 2048,
    TOP_P           NUMBER(3,2),
    EXTRA_PARAMS    CLOB,                     -- JSON (추가 파라미터)
    IS_ACTIVE       CHAR(1) DEFAULT 'N',      -- Y: 현재 적용 버전
    CHANGE_REASON   VARCHAR2(500),
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP,
    UNIQUE (NODE_ID, VERSION_NO)
);

-- 프롬프트 버전
CREATE TABLE PM_PROMPT_VERSION (
    PROMPT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_ID         NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    -- ※ 편차: CONFIG_ID/PM_MODEL_CONFIG 미구현. 대신 아래 모델 컬럼이 직접 포함됨:
    --   MODEL_PROVIDER, MODEL_NM, TEMPERATURE, MAX_TOKENS, TOP_P, EXTRA_PARAMS
    CONFIG_ID       NUMBER REFERENCES PM_MODEL_CONFIG(CONFIG_ID),  -- 연계 모델 설정
    VERSION_NO      VARCHAR2(20) NOT NULL,    -- 예: 1.0.0 (major.minor.patch)
    SYSTEM_PROMPT   CLOB,                     -- 시스템 프롬프트
    USER_PROMPT     CLOB,                     -- 유저 프롬프트 템플릿 (변수 포함)
    IS_ACTIVE       CHAR(1) DEFAULT 'N',      -- Y: 현재 적용 버전
    CHANGE_SUMMARY  VARCHAR2(500),            -- 변경 요약 (커밋 메시지 역할)
    CHANGE_REASON   VARCHAR2(1000),           -- 변경 사유 상세
    PREV_PROMPT_ID  NUMBER REFERENCES PM_PROMPT_VERSION(PROMPT_ID),  -- 이전 버전 링크
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP,
    UNIQUE (NODE_ID, VERSION_NO)
);

-- 프롬프트 변수 정의
CREATE TABLE PM_PROMPT_VARIABLE (
    VAR_ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROMPT_ID       NUMBER NOT NULL REFERENCES PM_PROMPT_VERSION(PROMPT_ID),
    VAR_NAME        VARCHAR2(100) NOT NULL,   -- 예: inquiry_text
    VAR_TYPE        VARCHAR2(50) DEFAULT 'STRING',
    DESCRIPTION     VARCHAR2(300),
    DEFAULT_VALUE   VARCHAR2(500),
    IS_REQUIRED     CHAR(1) DEFAULT 'Y'
);

-- 골든 데이터셋 (테스트 케이스)
CREATE TABLE PM_TEST_DATASET (
    DATASET_ID      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_ID         NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    DATASET_NM      VARCHAR2(200) NOT NULL,
    DESCRIPTION     VARCHAR2(500),
    IS_ACTIVE       CHAR(1) DEFAULT 'Y',
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE TABLE PM_TEST_CASE (
    CASE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_ID      NUMBER NOT NULL REFERENCES PM_TEST_DATASET(DATASET_ID),
    INPUT_DATA      CLOB NOT NULL,            -- JSON (변수별 입력값)
    EXPECTED_OUTPUT CLOB,                     -- 기대 출력 (JSON 또는 텍스트)
    EVAL_CRITERIA   CLOB,                     -- 평가 기준 JSON (예: {"category": "배송"})
    CASE_TYPE       VARCHAR2(50) DEFAULT 'NORMAL',  -- NORMAL / EDGE / INJECTION
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 테스트 실행 기록
CREATE TABLE PM_TEST_RUN (
    RUN_ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RUN_TYPE        VARCHAR2(20) NOT NULL,    -- NODE / FULL_FLOW
    NODE_ID         NUMBER REFERENCES PM_NODE(NODE_ID),
    PROJECT_ID      NUMBER REFERENCES PM_PROJECT(PROJECT_ID),
    PROMPT_ID       NUMBER REFERENCES PM_PROMPT_VERSION(PROMPT_ID),
    DATASET_ID      NUMBER REFERENCES PM_TEST_DATASET(DATASET_ID),
    STATUS          VARCHAR2(20) DEFAULT 'PENDING',  -- PENDING/RUNNING/DONE/FAILED
    TOTAL_CASES     NUMBER DEFAULT 0,
    PASSED_CASES    NUMBER DEFAULT 0,
    FAILED_CASES    NUMBER DEFAULT 0,
    AVG_LATENCY_MS  NUMBER,
    TOTAL_TOKENS    NUMBER,
    STARTED_DT      TIMESTAMP,
    ENDED_DT        TIMESTAMP,
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 테스트 결과 (케이스별)
CREATE TABLE PM_TEST_RESULT (
    RESULT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RUN_ID          NUMBER NOT NULL REFERENCES PM_TEST_RUN(RUN_ID),
    CASE_ID         NUMBER REFERENCES PM_TEST_CASE(CASE_ID),
    ACTUAL_OUTPUT   CLOB,
    IS_PASSED       CHAR(1),
    EVAL_DETAIL     CLOB,                     -- 평가 상세 JSON
    LATENCY_MS      NUMBER,
    INPUT_TOKENS    NUMBER,
    OUTPUT_TOKENS   NUMBER,
    ERROR_MSG       VARCHAR2(1000),
    EXECUTED_DT     TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- RAGAS 평가 실행
CREATE TABLE PM_RAGAS_RUN (
    RAGAS_RUN_ID    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_ID         NUMBER NOT NULL REFERENCES PM_NODE(NODE_ID),
    PROMPT_ID       NUMBER NOT NULL REFERENCES PM_PROMPT_VERSION(PROMPT_ID),
    DATASET_ID      NUMBER NOT NULL REFERENCES PM_TEST_DATASET(DATASET_ID),
    STATUS          VARCHAR2(20) DEFAULT 'PENDING',
    FAITHFULNESS    NUMBER(5,4),              -- 0~1
    ANSWER_RELEVANCY NUMBER(5,4),
    CONTEXT_PRECISION NUMBER(5,4),
    CONTEXT_RECALL  NUMBER(5,4),
    ANSWER_CORRECTNESS NUMBER(5,4),
    STARTED_DT      TIMESTAMP,
    ENDED_DT        TIMESTAMP,
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 감사 로그
CREATE TABLE PM_AUDIT_LOG (
    LOG_ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TARGET_TABLE    VARCHAR2(50) NOT NULL,
    TARGET_ID       NUMBER NOT NULL,
    ACTION          VARCHAR2(20) NOT NULL,    -- CREATE / UPDATE / DELETE / ACTIVATE
    BEFORE_VALUE    CLOB,                     -- 변경 전 JSON
    AFTER_VALUE     CLOB,                     -- 변경 후 JSON
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

---

## 4. 화면 및 기능 명세

### 4.1 메인 화면 — 에이전트 그래프 뷰

#### 4.1.1 화면 설명

LangGraph의 구조를 시각적으로 표현하는 **인터랙티브 그래프** 화면이다.  
사용자는 이 화면에서 전체 Agent 플로우를 한눈에 파악하고, 각 노드를 클릭하여 해당 노드의 프롬프트 관리 화면으로 이동한다.

#### 4.1.2 화면 구성 요소

| 영역 | 설명 |
|------|------|
| 그래프 캔버스 | React Flow 기반 노드-엣지 인터랙티브 그래프 |
| 상단 툴바 | 프로젝트 선택 드롭다운, 그래프 레이아웃 자동 정렬, 줌 컨트롤 |
| 노드 카드 | 노드명, 타입 아이콘, Active 프롬프트 버전, 상태 배지 표시 |
| 엣지 레이블 | 분기 조건 표시 (예: "IT 문의", "일반 문의") |
| 우측 사이드패널 | 노드 클릭 시 요약 정보 표시 (이름, 현재 버전, 최근 테스트 결과) |
| 그래프 편집 모드 | 노드 위치 드래그, 엣지 연결 추가/삭제 |

#### 4.1.3 기능 목록

**F-01. 그래프 렌더링**
- Oracle DB의 PM_NODE, PM_NODE_EDGE 데이터를 기반으로 그래프 자동 렌더링
- 노드 타입별 아이콘 및 색상 구분 (LLM 노드 / Tool 노드 / Router 노드 / START / END)
- 엣지의 분기 조건 레이블 표시

**F-02. 노드 상태 표시**
- 각 노드 카드에 현재 Active 프롬프트 버전 배지 표시 (예: `v2.1.0`)
- 사용 중인 LLM 모델명 표시 (예: `claude-sonnet-4`)
- 최근 테스트 결과 상태 표시 (✅ 통과 / ❌ 실패 / ⚠️ 미실행)

**F-03. 노드 클릭 → 프롬프트 관리 이동**
- 노드 클릭 시 우측 사이드패널에 요약 정보 표시
- "프롬프트 관리" 버튼 클릭 시 해당 노드의 프롬프트 관리 화면으로 라우팅 (`/nodes/{node_id}/prompts`)

**F-04. 그래프 레이아웃 관리**
- 노드 위치 드래그 후 "저장" → Oracle DB 좌표 업데이트
- 신규 노드 추가 / 엣지 연결 추가 기능

---

### 4.2 프롬프트 관리 화면

#### 4.2.1 화면 설명

특정 노드의 프롬프트 버전 목록 조회, 신규 버전 작성, 버전 간 Diff 비교, Active 버전 전환을 수행하는 핵심 화면이다.

#### 4.2.2 화면 구성 요소

| 영역 | 설명 |
|------|------|
| 상단 브레드크럼 | 프로젝트명 > 노드명 > 프롬프트 관리 |
| 버전 목록 패널 (좌) | 버전 번호, 생성일, 작성자, Active 여부, 요약 목록 |
| 프롬프트 에디터 (우) | System Prompt / User Prompt 편집 영역 (코드 에디터 스타일) |
| 변수 정의 탭 | 프롬프트 내 `{{variable}}` 변수 목록 및 설명 |
| Diff 뷰어 | 두 버전 선택 후 차이점 강조 표시 |
| 메타데이터 패널 | 연계 모델 설정, 변경 사유, 변경 이력 타임라인 |

#### 4.2.3 기능 목록

**F-10. 버전 목록 조회**
- 해당 노드의 모든 프롬프트 버전을 최신순으로 목록 표시
- Active 버전은 상단 고정 및 강조 표시
- 버전별 요약 정보: 버전번호, 연계 모델, 작성자, 생성일시, 변경 요약

**F-11. 신규 버전 작성**
- 현재 Active 버전을 기반으로 복사하여 새 버전 초안 생성
- System Prompt / User Prompt 독립 편집
- 변수 자리표시자 `{{variable_name}}` 자동 감지 및 변수 목록 동기화
- 버전 번호 자동 제안 (현재 버전 + patch increment), 수동 입력 가능
- 변경 요약(Change Summary) 및 변경 사유(Change Reason) 필수 입력
- 연계할 모델 설정(Config ID) 선택
- "저장(Draft)" / "저장 및 테스트" 버튼 구분

**F-12. 버전 간 Diff 비교**
- 좌/우 버전 선택기로 두 버전 선택
- System Prompt, User Prompt 각각 라인 단위 Diff 강조 표시 (추가 = 녹색, 삭제 = 빨간색)
- 변경된 라인 수 요약 표시

**F-13. Active 버전 전환**
- 목록에서 특정 버전 선택 후 "이 버전으로 적용" 클릭
- 확인 모달: "현재 v1.2.0 → v1.3.0으로 전환합니다. 계속하시겠습니까?"
- 전환 시 기존 Active 버전의 IS_ACTIVE = 'N', 신규 버전 IS_ACTIVE = 'Y' 업데이트
- PM_AUDIT_LOG에 변경 전/후 기록

**F-14. 이전 버전 롤백**
- Active 버전에서 "롤백" 버튼 클릭 시 이전 버전(PREV_PROMPT_ID) 자동 선택 후 전환

**F-15. 변수 정의 관리**
- 프롬프트 내 `{{...}}` 패턴 자동 파싱하여 변수 후보 목록 표시
- 변수별 타입(STRING / NUMBER / JSON), 설명, 기본값, 필수 여부 설정
- 변수 정의는 해당 버전의 PM_PROMPT_VARIABLE에 저장

---

### 4.3 모델 설정 관리 화면

#### 4.3.1 화면 설명

각 노드에서 사용하는 LLM 모델 설정을 버전별로 관리하는 화면이다. 프롬프트 버전과 독립적으로 버전 관리되므로, 프롬프트는 유지하면서 모델만 교체하거나 반대의 경우도 가능하다.

#### 4.3.2 기능 목록

**F-20. 모델 설정 버전 목록 조회**
- 노드별 모델 설정 버전 목록 (Provider, 모델명, Temperature 등 요약)
- Active 설정 강조

**F-21. 신규 모델 설정 등록**
- Provider 선택 (anthropic / openai / google / etc.)
- 모델명 입력 또는 Provider별 지원 모델 드롭다운 선택
- Temperature, Max Tokens, Top-P 슬라이더/입력
- 추가 파라미터(Extra Params): JSON 에디터로 자유 입력 (예: `{"stop_sequences": [...]}`)
- 버전 번호 및 변경 사유 입력 후 저장

**F-22. Active 모델 설정 전환**
- 프롬프트 관리와 동일한 방식의 전환 흐름 (확인 모달 → 전환 → 감사 로그)

---

### 4.4 노드 단위 테스트 화면

#### 4.4.1 화면 설명

특정 노드의 특정 프롬프트 버전을 **단독으로 실행**하여 결과를 즉시 확인하는 화면이다.  
골든 데이터셋을 사용한 배치 테스트와, 단건 즉석 테스트 두 가지 모드를 지원한다.

#### 4.4.2 기능 목록

**F-30. 즉석 단건 테스트 (Playground)**
- 테스트할 프롬프트 버전 선택
- 모델 설정 선택 (Active 기본)
- 변수별 입력값 폼 자동 생성 (PM_PROMPT_VARIABLE 기반)
- "실행" 클릭 → LLM API 호출 → 결과 스트리밍 표시 (WebSocket)
- 결과 영역: 실제 출력, 소요 시간(ms), 입출력 토큰 수 표시

**F-31. 골든 데이터셋 배치 테스트**
- 사용할 데이터셋 선택 (PM_TEST_DATASET)
- 테스트할 프롬프트 버전 선택 (비교 목적 시 2개까지 동시 선택 가능)
- "테스트 시작" → PM_TEST_RUN 레코드 생성 후 비동기 실행
- 실행 진행률 바 표시 (WebSocket 실시간 업데이트)
- 완료 후 결과 요약: 통과율(%), 평균 지연시간, 총 토큰 비용 추정

**F-32. 버전 A/B 비교 테스트**
- 두 프롬프트 버전을 동일 데이터셋으로 동시 실행
- 케이스별 두 버전의 출력 나란히 표시 (Side-by-side)
- 케이스별 Pass/Fail 비교 및 총점 비교 차트

**F-33. 테스트 결과 상세 조회**
- 케이스별 결과 목록: 입력 → 기대 출력 → 실제 출력 → 평가 결과
- 실패 케이스 필터링 및 상세 오류 메시지 확인
- 결과 CSV 내보내기

**F-34. 골든 데이터셋 관리**
- 데이터셋 생성/수정/삭제
- 테스트 케이스 개별 추가 (입력, 기대 출력, 평가 기준, 케이스 유형 입력)
- CSV 일괄 업로드 (컬럼: input_json, expected_output, eval_criteria, case_type)
- 테스트 결과에서 케이스를 데이터셋으로 저장하는 "케이스 등록" 버튼

---

### 4.5 전체 플로우 테스트 화면

#### 4.5.1 화면 설명

프로젝트 전체 Agent 플로우를 End-to-End로 실행하여, 사용자 입력이 각 노드를 거쳐 최종 응답으로 도출되는 전체 과정을 검증하는 화면이다.

#### 4.5.2 기능 목록

**F-40. 플로우 단건 실행**
- 시작 노드에 투입할 입력값 입력 폼
- 각 노드에서 사용할 버전 선택 (기본값: 각 노드의 Active 버전)
- "실행" 클릭 → 전체 플로우 순차 실행
- 실행 진행 상황을 그래프 뷰에서 노드별 하이라이트로 표시
- 실행 완료 시 각 노드의 입출력 및 소요 시간 트레이스 표시

**F-41. 플로우 트레이스 뷰어**
- 노드 실행 순서 타임라인 표시
- 각 노드 클릭 시 해당 단계의 입력 / 출력 / 사용 모델 / 소요 시간 패널 표시
- 오류 발생 노드 빨간색 강조 및 에러 메시지 표시

**F-42. 플로우 배치 테스트**
- 다수의 시나리오(입력 케이스) 일괄 실행
- 케이스별 최종 출력 및 전체 플로우 소요 시간 결과 표
- 결과 CSV 내보내기

---

### 4.6 RAGAS 평가 화면

#### 4.6.1 화면 설명

RAGAS 프레임워크를 활용하여 프롬프트의 품질을 자동으로 정량 평가하는 화면이다.  
특히 RAG 기반 노드에서 Faithfulness, Answer Relevancy, Context Precision 등의 지표를 측정한다.

#### 4.6.2 평가 지표

| 지표 | 설명 |
|------|------|
| Faithfulness | 생성된 답변이 제공된 컨텍스트에 근거하는 정도 |
| Answer Relevancy | 답변이 질문에 얼마나 관련 있는지 |
| Context Precision | 관련 컨텍스트가 얼마나 정확하게 검색되었는지 |
| Context Recall | 필요한 컨텍스트가 얼마나 빠짐없이 검색되었는지 |
| Answer Correctness | 답변의 사실적 정확성 (참조 답변 대비) |

#### 4.6.3 기능 목록

**F-50. RAGAS 평가 설정**
- 평가 대상 노드 및 프롬프트 버전 선택
- 평가에 사용할 데이터셋 선택
  - 데이터셋 케이스 구성: question, answer (LLM 생성), contexts (검색 컨텍스트), ground_truth
- 평가에 사용할 Judge LLM 설정 (별도 모델 선택 가능)
- 평가할 지표 선택 (체크박스)

**F-51. RAGAS 평가 실행**
- "평가 시작" 클릭 → PM_RAGAS_RUN 레코드 생성 후 비동기 실행
- 백엔드에서 ragas 라이브러리를 통해 각 케이스별 지표 계산
- 실시간 진행률 WebSocket 업데이트

**F-52. RAGAS 평가 결과 조회**
- 지표별 평균 점수 레이더 차트 / 바 차트
- 케이스별 지표 점수 상세 테이블
- 이전 평가 실행과의 비교 (버전별 점수 추이 라인 차트)
- 점수 낮은 케이스 필터링 및 원인 분석 패널

**F-53. 평가 이력 관리**
- 노드별 RAGAS 평가 실행 이력 목록
- 실행별 주요 지표 요약 및 사용 버전 기록
- 평가 결과 PDF/Excel 내보내기

---

### 4.7 변경 이력 (감사 로그) 화면

**F-60. 전체 변경 이력 조회**
- PM_AUDIT_LOG 기반 전체 이력 타임라인
- 필터: 대상 테이블, 작성자, 기간, 액션(CREATE/UPDATE/ACTIVATE)
- 이력 항목 클릭 시 변경 전/후 JSON Diff 뷰어 표시

**F-61. 노드별 변경 이력**
- 특정 노드의 프롬프트 / 모델 설정 변경 이력 통합 표시
- 버전 변경 타임라인으로 시각화

---

## 5. API 명세

### 5.1 기본 규칙

- Base URL: `http://localhost:8000/api/v1` (운영 시 `https://{host}/api/v1`)
- 인증: 없음 (모든 API 공개 — 사내 신뢰 환경 가정)
- 응답 형식: JSON
- 페이지네이션: `?page=1&size=20` (예: `GET /audit-logs`)
- 에러 응답: FastAPI 기본 형식 `{"detail": "<메시지>"}` — 커스텀 `{code, message, detail}` 핸들러는 **미구현**
- WebSocket은 `/api/v1` 접두사 없이 루트(`/ws/...`)에 마운트됨

### 5.2 주요 엔드포인트

#### 프로젝트 / 노드

```
GET    /projects                         - 프로젝트 목록
GET    /projects/{project_id}/graph      - 그래프 데이터 (노드 + 엣지)
PUT    /projects/{project_id}/graph      - 그래프 레이아웃 저장
GET    /projects/{project_id}/nodes      - 노드 목록
POST   /projects/{project_id}/nodes      - 노드 생성
PUT    /nodes/{node_id}                  - 노드 수정
```

#### 프롬프트 관련

```
GET    /nodes/{node_id}/prompts          - 버전 목록
POST   /nodes/{node_id}/prompts          - 신규 버전 생성 (모델 설정 포함)
GET    /prompts/diff?v1={id}&v2={id}     - 두 버전 Diff
GET    /prompts/{prompt_id}              - 버전 상세
PUT    /prompts/{prompt_id}/activate     - Active 전환
GET    /prompts/{prompt_id}/variables    - 변수 목록
PUT    /prompts/{prompt_id}/variables    - 변수 일괄 저장
```

> ※ 별도 모델 설정 API(`GET/POST /nodes/{id}/configs`, `PUT /configs/{id}/activate`)는 **제거됨**.
> 모델 설정(`MODEL_PROVIDER/MODEL_NM/TEMPERATURE/MAX_TOKENS/TOP_P/EXTRA_PARAMS`)은
> 프롬프트 버전 생성·수정 시 함께 저장된다 (상단 편차 절 참조).

#### 데이터셋 / 테스트 케이스

```
GET    /nodes/{node_id}/datasets               - 노드별 데이터셋 목록
POST   /nodes/{node_id}/datasets               - 데이터셋 생성
GET    /datasets/{dataset_id}                  - 데이터셋 상세
PUT    /datasets/{dataset_id}                  - 데이터셋 수정
DELETE /datasets/{dataset_id}                  - 데이터셋 삭제
GET    /datasets/{dataset_id}/cases            - 케이스 목록
POST   /datasets/{dataset_id}/cases            - 케이스 추가
PUT    /datasets/{dataset_id}/cases/{case_id}  - 케이스 수정
DELETE /datasets/{dataset_id}/cases/{case_id}  - 케이스 삭제
POST   /datasets/{dataset_id}/upload           - CSV 일괄 업로드
```

#### 테스트 / 플로우

```
POST   /nodes/{node_id}/test/run         - 즉석 단건 테스트 실행
POST   /nodes/{node_id}/test/batch       - 배치 테스트 실행 (비동기)
POST   /nodes/{node_id}/test/ab          - 버전 A/B 비교 테스트 (비동기)
GET    /test-runs/{run_id}               - 테스트 실행 상태 조회
GET    /test-runs/{run_id}/results       - 테스트 결과 목록
POST   /projects/{project_id}/flow/run   - 전체 플로우 실행
```

#### RAGAS 관련

```
POST   /nodes/{node_id}/ragas/run        - RAGAS 평가 실행 (비동기)
GET    /ragas-runs/{ragas_run_id}        - 평가 상태 / 결과 조회
GET    /nodes/{node_id}/ragas-runs       - 노드별 평가 이력
```

#### 결과 내보내기 (Export)

```
GET    /test-runs/{run_id}/export?fmt=csv|xlsx        - 테스트 결과 내보내기
GET    /ragas-runs/{ragas_run_id}/export?fmt=csv|xlsx - RAGAS 결과 내보내기
```

> CSV / Excel(xlsx)만 지원 — **PDF 미지원**.

#### 실시간 (WebSocket)

`/api/v1` 접두사 없이 루트에 마운트된다.

```
WS    /ws/test-runs/{run_id}            - 테스트 진행률 스트리밍
WS    /ws/flow-runs/{run_id}            - 플로우 실행 트레이스 스트리밍
WS    /ws/ragas-runs/{ragas_run_id}     - RAGAS 평가 진행률
```

#### 감사 로그

```
GET    /audit-logs                       - 전체 변경 이력 (필터: target_table, user, action, date_from, date_to / page, size)
GET    /nodes/{node_id}/audit-logs       - 노드별 변경 이력
```

#### 유틸리티

```
GET    /health                           - 헬스 체크 (루트 — /api/v1 아님)
```

---

## 6. 비기능 요구사항

### 6.1 성능

| 항목 | 목표 |
|------|------|
| 그래프 초기 로딩 | 2초 이내 (노드 100개 이하 기준) |
| 즉석 테스트 응답 시작 | LLM API 응답 스트리밍 즉시 표시 |
| 배치 테스트 처리 | 비동기 처리, 케이스당 최대 30초 타임아웃 |
| API 응답 (DB 조회) | 200ms 이내 (95th percentile) |

### 6.2 보안

- 애플리케이션 레벨 인증 없음 → 네트워크 레벨(사내망/방화벽/리버스 프록시)에서 접근 통제
- 프롬프트 내용은 Oracle DB에서 암호화 저장 (TDE 또는 컬럼 암호화 검토)
- LLM API 키는 환경변수 / Vault에서 관리, DB/Frontend에 노출 금지
- Active 버전 전환·삭제 등 모든 작업은 접근 가능한 사용자에게 허용(역할 구분 없음)

### 6.3 가용성 및 운영

- 프롬프트 관리 시스템 장애 시 AI Agent 본 서비스에 영향 없도록 설계 (Agent는 캐시된 프롬프트 사용)
- Oracle DB 장애 대비 프롬프트 로컬 캐시(Redis 또는 인메모리) 적용 검토
- 배치 테스트 / RAGAS 평가는 별도 Worker 프로세스(FastAPI BackgroundTasks 또는 Celery)로 분리

### 6.4 확장성

- 신규 LLM Provider 추가 시 Provider 어댑터 클래스만 추가하면 되도록 플러그인 구조로 설계
- 신규 평가 지표 추가 시 RAGAS 평가 모듈 확장 가능한 구조 유지
- 프로젝트(AI Agent) 다수 관리 가능한 멀티 프로젝트 구조 지원

### 6.5 사용성

- 프롬프트 에디터는 신택스 하이라이팅 지원 (변수 `{{...}}` 강조)
- 변경 이력은 Git 커밋 로그처럼 요약-상세 2단계로 표시
- 주요 액션(Active 전환, 삭제)은 확인 모달 필수

---

## 부록 A. 개발 우선순위 (Phase 계획)

| Phase | 기능 | 기간 |
|-------|------|------|
| Phase 1 | DB 스키마, 그래프 뷰, 프롬프트 버전 CRUD, Active 전환 | 3주 |
| Phase 2 | 모델 설정 관리, 즉석 단건 테스트, 골든 데이터셋 관리 | 3주 |
| Phase 3 | 배치 테스트, A/B 비교 테스트, 전체 플로우 테스트 | 3주 |
| Phase 4 | RAGAS 평가, 변경 이력 대시보드, CSV 내보내기 | 2주 |

## 부록 B. 연동 외부 서비스

| 서비스 | 용도 | 비고 |
|-------|------|------|
| Anthropic API | Claude 모델 호출 | anthropic Python SDK |
| OpenAI API | GPT 모델 호출 | openai Python SDK |
| Google AI API | Gemini 모델 호출 | google-generativeai SDK |
| Oracle DB | 모든 데이터 영구 저장 | python-oracledb |
| RAGAS | 자동 평가 지표 계산 | ragas Python 라이브러리 |
