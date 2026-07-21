# AutoPrompt — Prompt Management & RAGAS

AI Agent의 프롬프트/모델 설정을 중앙에서 버전 관리하고, 전체 플로우 단위 **RAGAS 회귀 평가**를 수행하는 웹 시스템. **백엔드 없이 단일 Next.js 14 앱**으로 동작한다(FastAPI 백엔드는 제거되고 로직이 Next.js route handler + `src/lib`로 이식됨).

- Stack: **Next.js 14 (App Router)** + TypeScript + Tailwind(토큰 기반 디자인 시스템)
- DB: **Oracle 19c+** — `oracledb` 드라이버로 직접 접근 (PM_* 6개 테이블). Docker 미사용, 로컬 직접 설치
- 인증: **없음** (사내 단일 신뢰 환경 가정). 네트워크 레벨에서 접근 통제할 것
- 설계 톤: `C:\work\inview` 앱과 동일한 구조·톤앤매너(설정 yml + `deploy.sh` + `src/lib` 패턴)로 정렬 — 추후 inview 통합 대비

## 디렉토리 구조

```
config.yml / config.dev.yml   Oracle 접속 + 외부 에이전트 설정 (dev.yml 존재 → dev, 없으면 prd)
deploy.sh                     배포 스크립트 (git reset → build → nohup next start)
sql/ddl_initial.sql           PM_* 스키마 (권위 스키마)
src/
  app/            페이지(page.tsx=RAGAS, nodes/…) + api/**/route.ts (모든 API)
  lib/            config·logger·db, db/rows, services/*(prompt·dataset·flow·ragas·export·externalAgent), types
  components/ui   공용 UI 컴포넌트
```

## 설정 (config.yml)

`config.dev.yml`이 있으면 dev, 없으면 `config.yml`(prd)로 동작한다. `deploy.sh prd`는 `config.dev.yml`을 지워 prd로 강제한다.

```yaml
db:                       # PM_* 테이블이 있는 Oracle 접속. 비우면 DB 미연결(조회=빈결과, 쓰기=명확한 에러)
  user: "pm_user"
  password: "pm_password"
  connectString: "localhost:1521/XEPDB1"
agent:                    # flow-level RAGAS 답변 생성용 외부 채팅 엔드포인트
  runMode: "stub"         # stub=결정론적 placeholder / external=실제 엔드포인트 호출
  baseUrl: ""
  authKey: ""
  userId: "pm-test"
```

## 실행

```bash
npm install
# dev 서버 (config.dev.yml 사용). 포트 5175
npm run dev
```

`http://localhost:5175` — 루트(`/`)는 **RAGAS 회귀 평가**(Single / Compare / Direct / Datasets / Records). 프롬프트 관리는 상단 내비의 **Prompts**(`/nodes` → `/nodes/{node}/prompts`).

### DB 스키마

마이그레이션 도구 없음. `sql/ddl_initial.sql`을 PM Oracle 스키마에 직접 적용한다(PM_* 6개 테이블만 생성; 운영 테이블은 건드리지 않음). DB 미설정 상태로도 UI는 뜨며 조회는 빈 결과가 된다.

### 검증

```bash
npm run typecheck      # tsc --noEmit  (npm run build 는 dev .next 캐시를 건드릴 수 있어 typecheck 권장)
```

## RAGAS 스코어링 (중요)

이 앱은 **FALLBACK 스코어러**(토큰 겹침 휴리스틱, 의존성 없음)만 내장한다. 파이썬 `ragas` 라이브러리 기반의 실(semantic) 스코어링은 Node에서 실행 불가하므로 **별도 런타임 환경**이 담당하고, 이 앱은 참조/평가-스텁 성격을 유지한다. 답변 생성은 `agent.runMode=external`이면 실제 채팅 엔드포인트를, 기본 `stub`이면 placeholder를 사용한다.

## 진행 스트리밍 (SSE)

RAGAS 실행 진행상황은 WebSocket 대신 **SSE**로 전송된다. `POST /api/flow/test/ragas`가 run(PENDING)을 만들고, 프론트가 `GET /api/ragas-runs/{id}/stream`(EventSource)에 붙으면 그 스트림이 평가 루프를 구동하며 `RUNNING/ANSWER/SCORE/DONE` 이벤트를 흘린다. 취소는 `POST /api/ragas-runs/{id}/cancel`(STATUS=CANCELLING).

## 내보내기

`GET /api/ragas-runs/{id}/export?fmt=csv` / `…/ab/{groupId}/export?fmt=csv` — **CSV(UTF-8 BOM)만 지원**. 파이썬 전용 라이브러리가 필요하던 xlsx는 제거됨(CSV를 Excel에서 열 것).

## 배포

`deploy.sh [dev|prd]` — inview와 동일 패턴(git reset → npm install → build → prune → `next start -p 5175`). 스크립트 상단의 `GIT_REPO_URL`/`DEPLOY_DIR` 등을 환경에 맞게 수정.

## 라이선스

내부 프로젝트.
