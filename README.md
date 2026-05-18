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

## 현재 단계: Phase 2 (백엔드)

Phase 1 (프로젝트·그래프·노드 / 프롬프트 버전·Diff·변수 / 감사 로그 /
Frontend 기본 화면) 구현 완료. **로그인/인증은 전면 제거됨.**

Phase 2 백엔드 추가분:

- LLM Provider 어댑터 (`app/services/llm/` — anthropic / openai / google, 공통 `invoke`)
- **모델 설정은 프롬프트 버전에 종속** — 별도 ModelConfig 엔티티 없음. 프롬프트 버전 생성 시
  `model_provider/model_nm/temperature/max_tokens/top_p/extra_params`를 함께 지정
- 데이터셋/케이스 CRUD: `/api/v1/nodes/{id}/datasets`, `/api/v1/datasets/{id}/cases`,
  CSV 업로드 `POST /api/v1/datasets/{id}/upload`
- 즉석 단건 테스트: `POST /api/v1/nodes/{id}/test/run` +
  WebSocket 스트리밍 `WS /ws/test-runs/{run_id}` (모델은 프롬프트 버전에서 사용)
- 그래프는 LangGraph식 세로(top→bottom) 레이아웃, history는 노드별 스코프

> Phase 2 프론트엔드 화면 및 프롬프트 캐시(§6.3, 소비처인 Agent 연동이 Phase 3)는
> 후속 작업. Phase 2~4 전체 범위는 [`docs/phase-roadmap.md`](./docs/phase-roadmap.md) 참조.

## Backend 실행

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate              # Windows
# source .venv/bin/activate         # macOS/Linux
pip install -e .[dev]

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
