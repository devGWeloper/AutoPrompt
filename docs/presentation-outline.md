# AutoPrompt 발표 개요

> **대상**: 개발자 / 기술팀
> **시간**: 14분 (슬라이드 ~8분 + 라이브 시연 ~6분)
> **산출물**: 본 문서를 PPT 디자인 툴(PowerPoint, Keynote, Slidev 등)에 그대로 옮겨 사용

---

## 시간 배분

| 구간 | 시간 | 슬라이드 |
|------|------|----------|
| 인트로 + 시스템 개요 | 1분 | 1~2 |
| 아키텍처 + 데이터 모델 | 3분 | 3~4 |
| 핵심 기능 + 설계 결정 | 3분 | 5~7 |
| **라이브 시연** | **6분** | 8 (인덱스) |
| 마무리 + Q&A | 1분 | 9 |

---

## Slide 1 — 표지

**AutoPrompt**
프롬프트 관리·테스트·평가 플랫폼

> LangGraph Agent의 프롬프트를 코드와 분리하다

- 발표자: (이름)
- 날짜: 2026-05-20

> **발표자 노트**: "오늘 LangGraph 기반 AI Agent를 위해 만든 프롬프트 관리 시스템 AutoPrompt를 소개드립니다. 약 14분, 시연 포함입니다."

---

## Slide 2 — 시스템 개요

### What we built

> **프롬프트·LLM 설정을 코드와 분리해 중앙에서 버전 관리·테스트·평가·감사하는 웹 시스템**

**Phase 1~4 구현 완료** — 주요 영역 4가지:

- 그래프 기반 Agent 시각화 + 노드별 프롬프트 버전 관리
- LLM 단건 / 배치 / A·B 테스트 (Anthropic · OpenAI · Google 지원)
- RAGAS 자동 평가 (5지표)
- 감사 로그 + CSV / Excel 내보내기

> **발표자 노트**: "한 줄로 정의하면 — 프롬프트를 코드와 분리해 중앙 관리하는 시스템입니다. 이 4가지 영역이 핵심이고, 뒤에서 하나씩 보겠습니다."

---

## Slide 3 — 아키텍처

```
┌─────────────────────────────────────────────────┐
│  Next.js 14 + React Flow + Monaco Editor        │  Frontend
└────────────────┬────────────────────────────────┘
                 │ REST / WebSocket
┌────────────────▼────────────────────────────────┐
│  FastAPI + SQLAlchemy 2.0 + Alembic             │  Backend
└─────┬──────────────────────────────┬────────────┘
      │                              │
┌─────▼──────────┐    ┌──────────────▼──────────────┐
│  Oracle 19c    │    │  LLM Adapters               │
│                │    │  (Anthropic / OpenAI / Google)│
└────────────────┘    └──────────────┬──────────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │  RAGAS Engine + Fallback    │
                      └─────────────────────────────┘
```

- **모놀리식 단일 배포** · 인증 없음 (사내 단일 신뢰 환경)
- WebSocket으로 테스트 / 플로우 실행을 실시간 스트리밍

> **발표자 노트**: "프론트는 Next.js + React Flow로 그래프 UI를, 백엔드는 FastAPI로 API 서버를 구성했습니다. LLM은 3개 Provider를 어댑터 패턴으로 추상화했고, RAGAS는 옵션 의존성입니다."

---

## Slide 4 — 데이터 모델 (12개 테이블)

### 4개 엔티티 그룹

| 그룹 | 테이블 |
|------|--------|
| **그래프** | `PM_PROJECT`, `PM_NODE`, `PM_NODE_EDGE` |
| **프롬프트** | `PM_PROMPT_VERSION` (모델 설정 내장), `PM_PROMPT_VARIABLE` |
| **테스트 / 평가** | `PM_TEST_DATASET`, `PM_TEST_CASE`, `PM_TEST_RUN`, `PM_TEST_RESULT`, `PM_RAGAS_RUN`, `PM_RAGAS_RESULT` |
| **감사** | `PM_AUDIT_LOG` |

### 강조 포인트

- 모델 파라미터(`provider`, `model_nm`, `temperature`, `max_tokens`, `top_p`, `extra_params`)는 **`PM_PROMPT_VERSION`에 내장** → 별도 model_config 테이블 없음
- Alembic 마이그레이션 3단계: `0001_initial_schema` → `0002_ragas_phase4` → `0003_drop_case_nm`

> **발표자 노트**: "총 12개 테이블을 4개 그룹으로 묶었습니다. 가장 중요한 설계 결정은 — 모델 설정을 별도 테이블로 빼지 않고 프롬프트 버전 자체에 묶었다는 점입니다. 롤백 단위가 깔끔해집니다."

---

## Slide 5 — 기능 1·2: 프롬프트 버전 + 테스트 3종

### 프롬프트 버전 관리

- **Monaco Editor** — System / User 프롬프트 분리 편집
- 변수 `{{var}}` **자동 감지** → `PM_PROMPT_VARIABLE`에 저장
- **라인 단위 Diff** (`diff_service.py`) · Active 전환 시 감사 로그 자동 기록

### 테스트 3종

| 모드 | 용도 |
|------|------|
| **Playground** | 즉석 단건 실행 (WS 스트리밍) |
| **Batch** | 골든 데이터셋 일괄 실행 (CSV 업로드) |
| **A/B** | 두 버전 동시 실행 → 결과 비교 |

핵심 파일: `backend/app/services/test_service.py`, `backend/app/api/v1/test_runs.py`

> **발표자 노트**: "프롬프트는 버전마다 스냅샷됩니다. 테스트는 3가지 모드 — 즉석 1건, 데이터셋 배치, 두 버전 비교 — 가 있고 모두 WebSocket으로 실시간 결과가 들어옵니다."

---

## Slide 6 — 기능 3·4: RAGAS 평가 + 감사 로그

### RAGAS 자동 평가

- **5지표**: Faithfulness, Answer Relevancy, Context Precision, Context Recall, Answer Correctness
- **플러그형 스코어러**: `ragas` 라이브러리 있으면 `ragas_engine.py`, 없으면 `fallback_scorer.py` 자동 사용
- Recharts 기반 **Radar / Bar / Line 차트**

### 감사 로그

- 모든 CRUD / ACTIVATE 액션에 **before / after JSON** 기록
- 필터(테이블 · 사용자 · 액션 · 기간) + **JSON Diff 뷰어**
- **CSV / Excel 내보내기** (`export_service.py`, openpyxl)

> **발표자 노트**: "RAGAS는 5개 지표로 자동 평가하고, 라이브러리가 없어도 폴백으로 항상 동작합니다. 감사 로그는 모든 변경을 JSON 단위로 추적해서 운영 사고 시 원복 근거가 됩니다."

---

## Slide 7 — 기술적 설계 결정 4가지

1. **LLM Adapter 플러그형 패턴**
   - `services/llm/base.py` 추상 클래스 + Provider별 구현 3종
   - 신규 Provider 추가 시 어댑터 1개만 작성

2. **RAGAS 옵션 의존성 + 폴백 스코어러**
   - 무거운 라이브러리 / API 키 의존성 회피
   - 운영환경에서 결정론적 폴백으로 항상 동작 보장

3. **모델 설정 = 프롬프트 버전 내장**
   - 별도 model_config 엔티티 미도입
   - 프롬프트와 모델 파라미터를 원자적으로 묶어 롤백 단위 일치

4. **WebSocket 실시간 스트리밍**
   - `core/ws.py` ConnectionManager로 테스트 / 플로우 진행률 · LLM 토큰을 실시간 푸시

> **발표자 노트**: "개발자분들이 가장 궁금해하실 4가지 설계 결정입니다. 특히 2번 — RAGAS 폴백 — 이 운영 안정성에 중요했고, 3번 — 모델 설정 내장 — 이 데이터 모델을 단순하게 만들었습니다."

---

## Slide 8 — 라이브 데모 (인덱스)

### 시연 단계 6개

1. **그래프 뷰** — Customer Inquiry Agent 프로젝트 열기
2. **프롬프트 버전 + Diff** — Intent Classifier v1.0.0 vs v1.1.0
3. **Playground 단건 테스트** — WS 스트리밍 응답
4. **RAGAS 결과 차트** — Radar / 케이스별 테이블
5. **감사 로그 + JSON Diff** — 최근 변경 추적
6. (여유 시) **플로우 End-to-End 실행** — 노드별 트레이스

> **발표자 노트**: "지금부터 화면으로 넘어가서 6단계로 시연하겠습니다. 옆 슬라이드에 단계를 띄워둘 테니 어디까지 왔는지 따라오시면 됩니다."

---

## Slide 9 — 향후 계획 + Q&A

### Roadmap

- 외부 LangGraph Agent 연동 어댑터 (현재는 시스템 내부 한정)
- 프롬프트 로컬 캐시 (Redis 또는 인메모리)
- 토큰 비용 추정 대시보드
- PDF 내보내기

### 질문 환영 🙋

> **발표자 노트**: "현재 시스템 내부에서 호출하는 구조라, 다음 단계는 외부 LangGraph Agent에서 우리 시스템의 프롬프트를 가져다 쓰는 어댑터입니다. 질문 받겠습니다."

---

# 📺 라이브 데모 시나리오 (6분)

각 단계의 **클릭 경로**와 **강조 멘트**.

### 1단계 — 그래프 뷰 (45초)

- **클릭**: `/projects` → "Customer Inquiry Agent" 카드 → Graph 탭
- **멘트**: *"노드가 곧 LLM 호출 단위, 엣지가 분기 흐름입니다. 코드를 안 봐도 Agent 구조가 한눈에 보입니다."*
- 핵심 파일: `frontend/src/app/projects/[projectId]/graph/page.tsx`

### 2단계 — 프롬프트 버전 + Diff (1분 15초)

- **클릭**: Intent Classifier 노드 클릭 → Prompts 탭 → v1.0.0 / v1.1.0 선택 → Diff
- **멘트**: *"Git diff 같은 라인 하이라이트입니다. 중요한 건 — 프롬프트 텍스트뿐 아니라 temperature, max_tokens 같은 모델 설정도 같이 버전에 묶입니다."*
- 핵심 파일: `frontend/src/components/prompts/DiffViewer.tsx`, `backend/app/services/diff_service.py`

### 3단계 — Playground 단건 테스트 (1분)

- **클릭**: Test 탭 → Playground → 입력 `I forgot my password` → Run
- **멘트**: *"WebSocket으로 토큰이 실시간 스트리밍됩니다. 응답시간, 토큰 수가 자동 기록되고요."*
- 핵심 파일: `backend/app/api/v1/test_runs.py`, `backend/app/services/test_service.py`

### 4단계 — RAGAS 결과 (1분 30초)

- **클릭**: RAGAS 탭 → **사전에 미리 돌려둔** Result 클릭 → Radar Chart + 케이스 테이블
- **멘트**: *"5개 지표가 자동 계산됐고, 라이브러리 없는 환경에서도 폴백으로 결정론적 점수가 나옵니다."*
- ⚠️ **라이브에서 새로 돌리지 말 것** — 시간 소요 / API 키 의존
- 핵심 파일: `backend/app/services/ragas/`, `frontend/src/app/projects/[projectId]/nodes/[nodeId]/ragas/page.tsx`

### 5단계 — 감사 로그 + JSON Diff (45초)

- **클릭**: Audit 탭 → 최근 변경 1건 클릭 → JSON Diff
- **멘트**: *"누가, 언제, 무엇을, 어떻게 바꿨는지 JSON 레벨로 추적합니다. 운영 사고 시 원복 근거가 됩니다."*
- 핵심 파일: `backend/app/api/v1/audit.py`

### 6단계 — (여유 시) 플로우 End-to-End (45초)

- **클릭**: Flow 탭 → JSON 입력 `{"input": "I need VPN help"}` → Run
- **멘트**: *"노드 색상이 idle → running → done으로 변하면서 전체 그래프가 실행되는 트레이스를 볼 수 있습니다."*
- 핵심 파일: `backend/app/services/flow_service.py`

---

# ✅ 발표 30분 전 체크리스트

라이브 시연 실패는 최대 리스크. 다음을 사전 확인:

- [ ] Backend 서버 가동 — `uvicorn app.main:app --reload --port 8000`
- [ ] Frontend 서버 가동 — `npm run dev` (port 3000)
- [ ] Oracle DB 연결 확인 — `http://localhost:8000/docs` 에서 `/api/v1/projects` 200 응답
- [ ] 시드 데이터 로드 완료 — `python -m scripts.seed_phase1`
- [ ] **사전 RAGAS run 1건 완료 상태** — 데모용으로 미리 돌려둘 것
- [ ] **사전 프롬프트 v1.1.0 1개 생성** — Diff 비교 대상 확보
- [ ] API 키 환경변수 확인 — Playground에서 LLM 호출 가능해야 함
- [ ] 브라우저 줌 125~150% — 뒷자리 가독성
- [ ] 다른 탭 / 노티 끄기 — 클린한 화면
- [ ] **네트워크 끊김 대비 백업 스크린샷 6장** — 6단계 각각 1장 (`docs/demo-screenshots/`)
- [ ] 입력 텍스트 클립보드 / 메모장에 준비:
  - `I forgot my password`
  - `{"input": "I need VPN help"}`

---

# 💬 청중 기술 질문 대비 메모

발표자 본인 참고용. 기술 청중이 던질 만한 질문 + 답변 포인트:

- **"프롬프트 변수 파싱은 어떻게?"**
  → `backend/app/services/variable_parser.py`에서 `{{var}}` 정규식 추출 → `PM_PROMPT_VARIABLE`에 정의. 누락 변수는 테스트 시 검증.

- **"신규 LLM Provider 추가하려면?"**
  → `services/llm/base.py` 상속받은 어댑터 1개만 추가. 기존 코드 수정 없음.

- **"RAGAS 의존성이 무거운데?"**
  → 옵션 의존성. 미설치 / API 키 없음 시 `fallback_scorer.py`가 결정론적으로 동작.

- **"DB는 왜 Oracle?"**
  → 사내 표준. SQLAlchemy 2.0이라 PostgreSQL 이식 용이. 테스트는 SQLite in-memory.

- **"WebSocket 다중 클라이언트 처리?"**
  → `core/ws.py` ConnectionManager가 run_id별 구독자 관리. 같은 테스트를 여러 탭에서 모니터링 가능.

- **"동시 테스트 격리?"**
  → `PM_TEST_RUN.run_id` 기준으로 결과 / 로그 분리. 비동기 실행은 FastAPI BackgroundTask.

- **"프롬프트 캐싱은?"**
  → 후속 과제 (Redis 또는 인메모리). 현재는 매번 DB 조회.

- **"인증은?"**
  → 사내 단일 신뢰 환경 가정. 네트워크 레벨에서 통제. JWT 도입 가능 구조.

- **"테스트 커버리지는?"**
  → pytest + pytest-asyncio, SQLite in-memory로 Oracle 의존성 없이 실행 (`cd backend && pytest`).
