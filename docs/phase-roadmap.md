# Phase 2 ~ 4 로드맵

이번 턴(Phase 1)에서 구현하지 않은 명세 항목 정리. 후속 작업의 출발점으로 사용한다.

## Phase 2 (3주) — 모델 설정 / 단건 테스트 / 데이터셋

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

## Phase 3 (3주) — 배치 테스트 / 전체 플로우

### Backend
- 배치 테스트 러너: `POST /nodes/{id}/test/batch`
  - FastAPI `BackgroundTasks`로 시작, 장기 실행은 Celery + Redis로 확장 검토
- A/B 비교 모드 (두 프롬프트 동시 실행)
- 외부 LangGraph Agent 호출 어댑터 (`app/services/external_agent.py`)
  - 사용자가 별도 운영 중인 Agent endpoint(예: `https://agent.example.com/run`)에 프로젝트의 active 버전 + 입력값을 전달
  - 트레이스 응답 수신 후 DB 저장
- `POST /projects/{id}/flow/run`, `WS /ws/flow-runs/{run_id}` 스트리밍

### Frontend
- 4.4 배치 테스트 / A/B 비교
- 4.5 전체 플로우 테스트 화면 (그래프 뷰 위에서 노드 하이라이트로 진행 표시)
- 트레이스 뷰어 컴포넌트

## Phase 4 (2주) — RAGAS / 감사 / 내보내기

### Backend
- `ragas` 라이브러리 통합 (`app/services/ragas_runner.py`)
- `POST /nodes/{id}/ragas/run`, `WS /ws/ragas-runs/{id}`
- 평가 이력 조회 / 비교 차트용 데이터 API
- 결과 내보내기: CSV / Excel(openpyxl) / PDF(weasyprint 또는 ReportLab)

### Frontend
- 4.6 RAGAS 평가 화면 (레이더 / 바 / 라인 차트 — recharts 추천)
- 4.7 변경 이력 대시보드 고도화 (전체 타임라인 + JSON Diff 뷰어)
- 결과 내보내기 버튼 (CSV / PDF)

## 비기능 / 운영 보강
- Phase 2: 프롬프트 캐시 (Redis 또는 인메모리) — 명세 §6.3
- Phase 2: LLM 호출 사용량 / 비용 추정 (configs에 단가 메타데이터 추가)
- Phase 4: Oracle TDE 또는 컬럼 암호화 가이드 문서화 — 명세 §6.2
- 권한 모델: 제거됨 (로그인/인증 전면 삭제 — 사내 단일 신뢰 환경 가정)

## 외부 의존성 추가 예정
- `anthropic`, `openai`, `google-generativeai`
- `ragas`
- `celery[redis]` 또는 RQ (배치 백엔드 결정 후)
- `openpyxl`, `weasyprint` 또는 `reportlab` (내보내기)
- (프론트) `recharts` 또는 `chart.js` (차트)
