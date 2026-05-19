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

Phase 4 추가분:

- RAGAS 평가: `POST /api/v1/nodes/{id}/ragas/run`,
  `GET /api/v1/ragas-runs/{id}`, `GET /api/v1/nodes/{id}/ragas-runs`,
  WebSocket `WS /ws/ragas-runs/{id}`
  - **플러그형 스코어러**: `app/services/ragas/` — 실제 `ragas` 라이브러리
    (옵션 의존성 `pip install -r requirements-ragas.txt`, Google 사용 시
    `langchain-google-genai` 포함) + 키가 있으면 RAGAS 엔진, 없으면 결정론적
    로컬 폴백 자동 사용 (`PM_RAGAS_RUN.ENGINE`에 기록)
  - **Judge 키는 별도 없음**: `.env`에 설정된 첫 provider 키
    (openai>anthropic>google)를 자동 사용. `RAGAS_ENGINE=auto|fallback|ragas`로
    동작 제어
  - 케이스별 지표는 `PM_RAGAS_RESULT`에 저장 (마이그레이션 `0002`)
- 결과 내보내기: `GET /api/v1/test-runs/{id}/export?fmt=csv|xlsx`,
  `GET /api/v1/ragas-runs/{id}/export?fmt=csv|xlsx` (CSV / Excel, **PDF 미지원**)
- Frontend: RAGAS 화면(설정/결과 차트/이력 추이 — recharts),
  변경 이력 대시보드(`/projects/{id}/audit` — 필터·페이지네이션·JSON Diff)
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
pip install -r requirements-dev.txt   # 런타임만: requirements.txt / + RAGAS: requirements-ragas.txt

cp .env.example .env                # 로컬 설치된 Oracle에 맞춰 ORACLE_DSN,
                                    # (단건 테스트용) ANTHROPIC/OPENAI/GOOGLE_API_KEY 수정
                                    # Docker 미사용 — Oracle은 로컬에 직접 설치되어 있어야 함

# DB 마이그레이션 (스키마가 바뀌었으면 재적용)
#   기존 DB가 구 스키마면: alembic downgrade base && alembic upgrade head
alembic upgrade head

# 초기 시드 데이터 (프로젝트, 노드, 프롬프트[모델 포함] — 사용자 계정 없음)
python -m scripts.seed_phase1

# 개발 서버
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

http://localhost:3000 — 루트 접속 시 로그인 없이 바로 프로젝트 목록으로 이동.

## Oracle 운영 환경 권고

- 컬럼/표 공간 단위 암호화(TDE) 적용 권고 — DBA 영역
- LLM API 키는 환경 변수 / Vault에서 관리 (`*_API_KEY`)
- 인증이 없으므로 네트워크 레벨(사내망/방화벽/리버스 프록시)에서 접근 통제할 것
- 프롬프트 관리 시스템 장애 시에도 AI Agent 본 서비스가 영향받지 않도록 캐시 적용 검토
  (소비처인 외부 Agent 연동이 Phase 3 범위 → 캐시도 Phase 3에서 도입)

## 라이선스

내부 프로젝트.
