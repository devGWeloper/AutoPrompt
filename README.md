# AI Agent Prompt Management System

LangGraph 기반 AI Agent의 프롬프트/모델 설정을 중앙에서 버전 관리·검증·배포하는 웹 시스템.

- Frontend: Next.js 14 (App Router) + React Flow + Monaco Editor + Tailwind
- Backend: FastAPI + SQLAlchemy 2.0 + Alembic
- DB: Oracle 19c+ (로컬에 직접 설치해 사용, Docker 미사용 / 개발용 테스트는 SQLite)
- 인증: **없음** (사내 단일 신뢰 환경 가정 — 모든 API가 토큰 없이 열림)

상세 명세는 [`prompt_management_spec.md`](./prompt_management_spec.md) 참조.

## 디렉토리 구조

```
backend/    FastAPI + SQLAlchemy + Alembic + pytest
frontend/   Next.js 14 + React Flow
docs/       Phase 2~4 로드맵 등 문서
```

## 현재 단계: Phase 4 완료

Phase 1~3 (프로젝트·그래프·노드 / 프롬프트 버전·Diff·변수 / 감사 로그 /
LLM 어댑터 3종 / 데이터셋·CSV / 단건·배치·A·B·플로우 테스트 / WebSocket 스트리밍)
구현 완료. **로그인/인증은 전면 제거됨.**

> **RAGAS 중심으로 재편됨(현재):** 첫 화면은 **전체 플로우 RAGAS 회귀 평가**(`/`)이고, 프롬프트 관리는
> `/nodes` → `/nodes/{id}/prompts`. 운영 고정 테이블 `CHAT_VER_MAS`/`NODE_MAS` 를 기준으로 동작하며,
> PM 소유 테이블은 **6개**: `PM_NODE_PROMPT_VER`, `PM_TEST_DATASET`/`PM_TEST_CASE`,
> `PM_RAGAS_RUN`/`PM_RAGAS_RESULT`, `PM_AUDIT_LOG`. **ACTIVATE 시 `SYSTEM_PROMPT`가 `NODE_MAS.PROMPT`에
> 기록**되어 운영에 반영된다(플로우 버전 스냅샷·메인 모델 변경 기능은 폐지). RAGAS 답 생성은
> `RUN_MODE=external` 이면 내부 모델 채팅 엔드포인트를 호출하고, 기본 `RUN_MODE=stub` 이면 임시
> placeholder 답변으로 동작한다. 단건/일괄/A·B 테스트·플로우 버전 이력과 그 테이블
> (`PM_TEST_RUN`/`PM_TEST_RESULT`/`PM_FLOW_VER`/`PM_FLOW_VER_NODE`)은 alembic `0008`에서 제거됐다.
> 연동 가이드: [`docs/integration-checklist.md`](./docs/integration-checklist.md).

Phase 4 추가분(현재 RAGAS는 **전체 플로우 단위**만):

- RAGAS 평가: `POST /api/v1/flow/test/ragas`,
  `GET /api/v1/ragas-runs`, `GET /api/v1/ragas-runs/{id}`,
  WebSocket `WS /ws/ragas-runs/{id}` (노드 단위 `/nodes/{id}/ragas/run` 은 제거됨)
  - **플러그형 스코어러**: `app/services/ragas/` — 실제 `ragas` 라이브러리
    (`ragas` / `langchain-google-genai`는 `requirements.txt`에 포함) + 키가
    있으면 RAGAS 엔진, 없으면 결정론적 로컬 폴백 자동 사용
    (`PM_RAGAS_RUN.ENGINE`에 기록)
  - **Judge 키는 별도 없음**: `.env`에 설정된 첫 provider 키
    (openai>anthropic>google)를 자동 사용. `RAGAS_ENGINE=auto|fallback|ragas`로
    동작 제어
  - **모델명은 모두 `.env`에서 주입(하드코딩 없음)**: 실엔진 사용 시 judge
    provider에 맞춰 judge 챗 모델(`GOOGLE_JUDGE_MODEL`·`OPENAI_JUDGE_MODEL`·
    `ANTHROPIC_JUDGE_MODEL`)과 임베딩 모델(`GOOGLE_EMBEDDING_MODEL`·
    `OPENAI_EMBEDDING_MODEL`)을 설정해야 한다. judge 챗 모델은 요청별
    `judge_model` 파라미터로 덮어쓸 수 있고, 둘 다 미설정이면 케이스별
    명확한 에러로 실패(기본값 없음)
  - 케이스별 지표는 `PM_RAGAS_RESULT`에 저장 (마이그레이션 `0002`)
- 결과 내보내기: `GET /api/v1/ragas-runs/{id}/export?fmt=csv|xlsx` (CSV / Excel, **PDF 미지원**)
- Frontend: RAGAS 평가 화면(`/` — 평가 실행/데이터셋/평가 기록 탭),
  노드 프롬프트 관리·변경 이력(`/nodes/{id}/prompts` 의 변경 이력 탭)
- 운영 가이드: [`docs/oracle-encryption-guide.md`](./docs/oracle-encryption-guide.md)
  (명세 §6.2 Oracle TDE / 컬럼 암호화)

> 전체 Phase 범위 및 후속 비기능 항목은
> [`docs/phase-roadmap.md`](./docs/phase-roadmap.md) 참조.

## Backend 실행

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate              # Windows
# source .venv/bin/activate         # macOS/Linux
pip install -r requirements.txt       # runtime + dev(pytest/ruff/mypy) + ragas 모두 포함
                                      # (pyproject.toml은 ruff/pytest 설정만 보유)

cp .env.example .env                # 로컬 설치된 Oracle에 맞춰 ORACLE_DSN,
                                    # (단건 테스트용) ANTHROPIC/OPENAI/GOOGLE_API_KEY 수정
                                    # Docker 미사용 — Oracle은 로컬에 직접 설치되어 있어야 함

# DB 마이그레이션 (체인: 0001 … 0007 → 0008[RAGAS 중심 정리])
#   0004는 구 PM_PROJECT/PM_NODE/... 를 드롭하고 새 PM_*를 만들고,
#   0008은 PM_TEST_RUN/PM_TEST_RESULT/PM_FLOW_VER/PM_FLOW_VER_NODE + 사장 컬럼을 드롭한다.
#   CHAT_VER_MAS/NODE_MAS/MODEL_MAS는 운영에 이미 존재한다고 가정(생성/변경하지 않음).
alembic upgrade head

# 개발 서버 (Oracle 사용 — .env). 테스트만 APP_ENV=test → SQLite
uvicorn app.main:app --reload --port 8000
```

로그인 없이 바로 사용. Swagger: http://localhost:8000/docs

### 테스트

```bash
cd backend
pytest
```

테스트는 in-memory SQLite를 사용 (Oracle 없이도 실행 가능). `APP_ENV=test` 환경변수가
`conftest.py`에서 자동 설정된다.

## Frontend 실행

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

http://localhost:3000 — 루트(`/`)는 **RAGAS 회귀 평가** 화면. 프롬프트 관리는 상단 내비의 "프롬프트 관리"(`/nodes`).

## Oracle 운영 환경 권고

- 컬럼/표 공간 단위 암호화(TDE) 적용 권고 — DBA 영역
- LLM API 키는 환경 변수 / Vault에서 관리 (`*_API_KEY`)
- 인증이 없으므로 네트워크 레벨(사내망/방화벽/리버스 프록시)에서 접근 통제할 것
- 운영 반영은 `NODE_MAS.PROMPT` 직접 기록 방식이므로, AI Agent 본 서비스는 PM 장애와 무관하게
  `NODE_MAS`만 읽어 동작한다(RAGAS 평가만 외부 채팅 엔드포인트 또는 stub 호출에 의존).

## 라이선스

내부 프로젝트.
