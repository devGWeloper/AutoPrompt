# Phase 2 ~ 4 로드맵 / 진행 현황

현재 상태 요약: **Phase 1~4 구현 완료.** 단, Phase 3의 *외부 LangGraph Agent
호출 어댑터*와 비기능의 *프롬프트 로컬 캐시(§6.3)*, *비용 추정*은 **미구현(후속)**.
(섹션별 ✅/❌ 표기 참조.)

## Phase 2 (3주) — 모델 설정 / 단건 테스트 / 데이터셋 — ✅ 완료

### Backend
- LLM Provider 어댑터 모듈 (`app/services/llm/`)
  - `anthropic_adapter.py`, `openai_adapter.py`, `google_adapter.py`
  - 공통 인터페이스: `async def invoke(prompt, variables) -> InvocationResult`
- 환경변수: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- 모델 설정: 별도 API/엔티티 없음 — **프롬프트 버전에 종속**(PM_PROMPT_VERSION에
  model_provider/model_nm/temperature/max_tokens/top_p/extra_params 컬럼)
- 즉석 단건 테스트: `POST /nodes/{id}/test/run` (F-30)
  - 동기 호출 + WebSocket `WS /ws/test-runs/{run_id}` 스트리밍
- 데이터셋 / 케이스 CRUD: `/datasets`, `/datasets/{id}/cases`, `POST /datasets/{id}/upload` (CSV)

### Frontend
- 4.3 모델 설정: 별도 화면 없음 — 프롬프트 새 버전 작성 폼에서 모델 함께 입력
- 4.4 노드 단위 테스트 화면 (Playground 탭 + 데이터셋 탭). 그래프는 세로 레이아웃
- 4.x 변경 이력: 노드별로 스코프된 history
- WebSocket 클라이언트(`lib/ws.ts`) — 인증 제거됨, 토큰 전달 없음

## Phase 3 (3주) — 배치 테스트 / 전체 플로우 — ✅ 일부 완료

### Backend
- ✅ 배치 테스트 러너: `POST /nodes/{id}/test/batch`
  - FastAPI `BackgroundTasks`로 시작, 장기 실행은 Celery + Redis로 확장 검토
- ✅ A/B 비교 모드 (두 프롬프트 동시 실행)
- ❌ **미구현(후속)** — 외부 LangGraph Agent 호출 어댑터
  (`app/services/external_agent.py` 없음)
  - 별도 운영 Agent endpoint에 프로젝트 active 버전 + 입력값 전달 →
    트레이스 응답 수신·저장. **현재 플로우 실행은 시스템 내부에서만 동작.**
- ✅ `POST /projects/{id}/flow/run`, `WS /ws/flow-runs/{run_id}` 스트리밍
  (내부 실행)

### Frontend
- 4.4 배치 테스트 / A/B 비교
- 4.5 전체 플로우 테스트 화면 (그래프 뷰 위에서 노드 하이라이트로 진행 표시)
- 트레이스 뷰어 컴포넌트

## Phase 4 (2주) — RAGAS / 감사 / 내보내기 — ✅ 완료

> 구현 결정: RAGAS는 **플러그형 + 폴백** (실제 `ragas`는 옵션 의존성,
> 미가용 시 결정론적 로컬 스코어러). 내보내기는 **CSV + Excel만, PDF 드롭**.

### Backend ✅
- 플러그형 스코어러 패키지 `app/services/ragas/`
  (`base.py` / `fallback_scorer.py` / `ragas_engine.py`) + `ragas_service.py`
- `POST /nodes/{id}/ragas/run`, `GET /ragas-runs/{id}`,
  `GET /nodes/{id}/ragas-runs`, `WS /ws/ragas-runs/{id}` (채널 키 `ragas:{id}`)
- 케이스별 지표 `PM_RAGAS_RESULT` + `PM_RAGAS_RUN` 확장 (alembic `0002`)
- 결과 내보내기 `export_service.py` + `/{test-runs|ragas-runs}/{id}/export?fmt=csv|xlsx`
  (CSV stdlib / Excel openpyxl; ~~PDF~~ 드롭)

### Frontend ✅
- 4.6 RAGAS 평가 화면 (`nodes/{id}/ragas` — 설정/결과/이력 탭,
  레이더·바·라인 차트, recharts)
- 4.7 변경 이력 대시보드 (`projects/{id}/audit` — 전체 타임라인 + 필터 +
  페이지네이션 + JSON Diff 뷰어, react-diff-viewer-continued 재사용)
- 결과 내보내기 버튼 (CSV / Excel; PDF 제외)

## 비기능 / 운영 보강
- ❌ **미구현(후속)** — 프롬프트 로컬 캐시 (Redis 또는 인메모리), 명세 §6.3
  (외부 Agent 연동과 함께 도입 예정)
- ❌ **미구현(후속)** — LLM 호출 사용량 / 비용 추정 (단가 메타데이터)
- ✅ Oracle TDE / 컬럼 암호화 — 가이드 문서화 완료
  (`docs/oracle-encryption-guide.md`, 명세 §6.2)
- ✅ 권한 모델 제거됨 (로그인/인증 전면 삭제 — 사내 단일 신뢰 환경 가정)

## 외부 의존성
모든 백엔드 의존성은 **단일 `backend/requirements.txt`** 에 통합(runtime +
dev + ragas 블록). 별도 requirements-dev/-ragas 파일 없음. `pyproject.toml`은
ruff/pytest 설정만 보유.
- `anthropic`, `openai`, `google-generativeai` (적용 완료)
- `openpyxl` (Excel 내보내기, 적용 완료)
- `ragas`, `datasets`, `langchain-google-genai` — `requirements.txt`에 포함.
  미설치/키 없음 시 결정론 폴백 스코어러 자동 사용
- (프론트) `recharts` — 차트 (적용 완료)
- ~~`weasyprint` / `reportlab` (PDF)~~ — 드롭
- `celery[redis]` 또는 RQ — 미적용 (현재 FastAPI BackgroundTasks로 충분)
