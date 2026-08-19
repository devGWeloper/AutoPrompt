# ScoreX — Prompt Management & Flow RAGAS

> DB 테이블 접두사 `PTX_*`는 이전 이름(Prompt Trace Explorer)에서 온 것으로, 스키마 호환을 위해 그대로 둔다.

AI Agent의 프롬프트/모델 설정을 중앙에서 버전 관리하고, 전체 플로우 단위 **RAGAS 회귀 평가**를 수행하는 웹 시스템. **백엔드 없이 단일 Next.js 14 앱**으로 동작한다(FastAPI 백엔드는 제거되고 로직이 Next.js route handler + `src/lib`로 이식됨).

- Stack: **Next.js 14 (App Router)** + TypeScript + Tailwind(토큰 기반 디자인 시스템)
- DB: **Oracle 19c+** — `oracledb` 드라이버로 직접 접근 (PTX_* 7개 테이블). Docker 미사용, 로컬 직접 설치
- 인증: **없음** (사내 단일 신뢰 환경 가정). 네트워크 레벨에서 접근 통제할 것
- 설계 톤: `C:\work\inview` 앱과 동일한 구조·톤앤매너(설정 yml + `deploy.sh` + `src/lib` 패턴)로 정렬 — 추후 inview 통합 대비

## 디렉토리 구조

```
config.yml / config.dev.yml   Oracle 접속 + 외부 에이전트 설정 (dev.yml 존재 → dev, 없으면 prd)
deploy.sh                     배포 스크립트 (git reset → build → nohup next start)
sql/ddl_initial.sql           PTX_* 스키마 (권위 스키마)
src/
  app/            페이지(page.tsx=RAGAS, nodes/…) + api/**/route.ts (모든 API)
  lib/            config·logger·db, db/rows, services/*(prompt·dataset·flow·ragas·export·externalAgent), types
  components/ui   공용 UI 컴포넌트
```

## 설정 (config.yml)

`config.dev.yml`이 있으면 dev, 없으면 `config.yml`(prd)로 동작한다. `deploy.sh prd`는 `config.dev.yml`을 지워 prd로 강제한다.

```yaml
db:                       # PTX_* 테이블이 있는 Oracle 접속. 비우면 DB 미연결(조회=빈결과, 쓰기=명확한 에러)
  user: "pm_user"
  password: "pm_password"
  connectString: "localhost:1521/XEPDB1"
agent:                    # flow-level RAGAS 답변 생성용 외부 채팅 엔드포인트
  runMode: "stub"         # stub=결정론적 placeholder / external=실제 엔드포인트 호출
  userId: "pm-test"       # 요청자 사번. 본문의 user_id / CUBE_USER_ID 로 나간다
  timeoutSec: 90          # 호출 1건의 응답 대기 한도(초). 넘기면 그 케이스만 실패로 기록된다
  a:                      # 기본 엔드포인트. 사이드를 안 고르는 실행은 전부 a 를 쓴다
    url: ""
    headers:              # 그대로 실려 나간다. Content-Type 은 코드가 붙임
      - name: ""
        value: ""
      - name: ""
        value: ""
  b:                      # 비교 대상. a 와 아무것도 공유하지 않는다
    url: ""
    headers:
      - name: ""
        value: ""
      - name: ""
        value: ""
ragasEngine: "auto"       # auto=LLM 설정 시 LLM 심판, 아니면 FALLBACK / fallback / ragas
llm:                      # 심판 LLM (OpenAI 호환). 비우면 LLM 채점 꺼짐 → FALLBACK
  endpoint: ""
  apiKey: ""
  model: ""
embedding:                # 임베딩 모델 (answer_relevancy / answer_correctness 유사도용)
  endpoint: ""
  apiKey: ""
  model: ""
```

## 실행

```bash
npm install
# dev 서버 (config.dev.yml 사용). 포트 5175
npm run dev
```

`http://localhost:5175` — 루트(`/`)는 **RAGAS 회귀 평가**(Single / Compare / Datasets / Records). Single 탭이 Dataset 실행과 Manual 단건 호출(구 Direct)을 모두 담당한다. 프롬프트 관리는 상단 내비의 **Prompts**(`/nodes` → `/nodes/{node}/prompts`).

### DB 스키마

마이그레이션 도구 없음. `sql/ddl_initial.sql`을 PTX Oracle 스키마에 직접 적용한다(PTX_* 7개 테이블만 생성; 운영 테이블은 건드리지 않음). DB 미설정 상태로도 UI는 뜨며 조회는 빈 결과가 된다. 컬럼 명세는 `docs/db-schema.md`.

테이블은 `PTX_<대상>_MAS|_DET|_HIS`, 컬럼은 `_ID/_NM/_NO/_CD/_CTN/_YN/_DT/_SCR` postfix 규칙을 따른다. 삭제 순서는 앱이 챙기지 않고 FK의 `ON DELETE CASCADE`/`SET NULL`에 맡긴다 — 데이터셋을 지워도 과거 실행 기록은 남고(`PTX_RUN_MAS.DATASET_NM` 스냅샷), 실행을 지우면 그 결과만 함께 사라진다. 옛 `PM_*` 스키마가 있으면 `sql/migrate_ptx_rename.sql`로 이름을 옮긴다.

### 중간 변수 채점

노드에 따라 최종 답변이 아니라 호출 도중의 변수(예: 슬롯 파싱 노드의 `parsed`)가 채점 대상이다. 응답에 실을 수 없으므로 에이전트가 `PTX_TRACE_HIS`에 `TRACE_ID`로 남기고 PTX가 읽어서 정답지와 비교한다. **행이 있으면 그 값을, 없으면 최종 답변을 채점한다** — 노드 매핑도 케이스 설정도 없다. 적용은 `sql/migrate_trace_var.sql`, 에이전트 쪽 연동은 `docs/trace-var-agent.md`.

### 검증

```bash
npm run typecheck      # tsc --noEmit  (npm run build 는 dev .next 캐시를 건드릴 수 있어 typecheck 권장)
```

## 평가 옵션

평가 옵션은 **정답 일치**(기본)와 **RAGAS** 두 갈래이고, RAGAS를 켜면 그 아래에서 5개 지표를 개별로 고른다.

- **정답 일치 (`exact_match`)** — `src/lib/exactMatch.ts`. 심판 LLM이 필요 없다. 응답 JSON에 `body`가 있으면 그 부분만, 정답(ground truth / 기대 정답)과 비교해 케이스별 O(1)/X(0)로 채점한다. 양쪽이 JSON이면 키 순서를 무시한 구조 비교, 아니면 공백 정규화 후 문자열 비교(대소문자 구분). 런 평균 = 일치율이고, 이 옵션만 켠 런은 `ENGINE='exact'`로 기록되며 LLM 채점 단계를 아예 건너뛴다.
- **RAGAS 5종** — 아래 스코어러를 탄다.

## RAGAS 스코어링 (중요)

스코어러는 두 가지가 내장돼 있고 `ragasEngine` 설정으로 고른다(`src/lib/config.ts` `resolveRagasEngine`).

- **RAGAS (LLM 심판)** — `src/lib/services/ragas/engine.ts`. 파이썬 `ragas` 라이브러리는 Node에서 실행 불가하므로, 각 지표를 OpenAI 호환 LLM/임베딩 호출로 재구현한 근사 구현이다. `llm.endpoint`가 설정돼 있어야 동작하며, `answer_relevancy`·`answer_correctness`의 유사도 계산에는 `embedding` 설정도 필요하다(없으면 해당 지표는 null).
- **FALLBACK** — 토큰 겹침 휴리스틱(의존성 없음, 한국어 조사 제거 포함). 결정론적이지만 lexical 근사일 뿐 semantic 판정이 아니다.

`ragasEngine: auto`(기본)는 `llm.endpoint`가 있으면 RAGAS, 없으면 FALLBACK으로 동작한다. `fallback`은 항상 FALLBACK 강제. 답변 생성은 `agent.runMode=external`이면 실제 채팅 엔드포인트를, 기본 `stub`이면 placeholder를 사용한다.

## 외부 엔드포인트 호출 형식

`src/lib/services/externalAgent.ts`. 요청 형식은 **하나뿐**이다 — 설정으로 고르는 분기가 없다.

```json
{ "message": "<질문>", "user_id": "<사번>", "session_id": "", "chat_type": "default", "session_system_prompt": "{…}" }
```

**딱 다섯 개**이고, 이 밖의 키는 보내지 않는다. `session_system_prompt`는 세션 컨텍스트(`CUBE_CHANNEL_ID`/`CUBE_CHANNEL_NM`/`CUBE_USER_ID`/`CUBE_USER_NM`/`TRACE_ID`)를 **문자열로 직렬화**한 값이다(에이전트가 `json.loads` 한다). `CUBE_USER_ID`는 호출자 사번(`agent.userId` 또는 요청의 `user_id`), `TRACE_ID`는 호출마다 `PTX-YYYYMMDD-NNNN`으로 발급된다(일 단위 리셋, 카운터는 프로세스 메모리).

응답에 `error` 객체가 있으면 200이어도 실패로 올린다(`엔드포인트 오류 <code> — <message>`). `result` 로 감싸 오면 그 안을 벗겨 채점한다.

헤더는 사이드별 `agent.a.headers` / `agent.b.headers`에 적은 이름·값이 그대로 나간다. A와 B는 아무것도 공유하지 않으므로 헤더 이름이 서로 달라도 된다(예: A는 `auth-key`, B는 `accesskey`). `Content-Type: application/json`은 코드가 항상 붙이므로 적지 않는다. URL은 설정값 뒤 슬래시만 떼고 **그 주소로 그대로 POST**한다(코드가 `/chat` 같은 경로를 붙이지 않음).

## 진행 스트리밍 (SSE)

RAGAS 실행 진행상황은 WebSocket 대신 **SSE**로 전송된다. `POST /api/flow/test/ragas`가 run(PENDING)을 만들고, 프론트가 `GET /api/ragas-runs/{id}/stream`(EventSource)에 붙으면 `RUNNING/ANSWER/SCORE/DONE` 이벤트가 흘러나온다. 취소는 `POST /api/ragas-runs/{id}/cancel`(STATUS=CANCELLING) 뿐이다.

**실행은 연결이 아니라 `src/lib/services/runRegistry.ts` 가 소유한다.** 스트림은 실행에 붙었다 떨어질 뿐이라 새로고침·탭 닫기·네트워크 끊김이 실행을 죽이지 않는다. 다시 붙으면 그동안의 이벤트(RUNNING → 케이스별 최신 결과 → 종료)를 재생받아 화면이 그대로 복구된다. 프론트는 진행 중인 run id 를 `sessionStorage`(`ptx.activeRun.*`)에 남겨 새로고침 후 자동 재접속한다. 레지스트리는 프로세스 메모리이므로 **서버가 재시작되면** 그 run 은 되살릴 수 없다 — 이 경우 재접속 시 케이스를 다시 실행해 행을 중복 적재하지 않고 해당 run 을 FAILED(`실행이 중단되었습니다…`)로 마감한다.

스트림에 `?side=a|b` 를 붙이면 그 런은 해당 쪽 엔드포인트(`agent.a.url` / `agent.b.url`)를 호출하고, `?base_url=` 를 함께 주면 그 URL이 우선한다. Compare 탭의 **엔드포인트** 모드가 이 경로로, 두 버전이 서로 다른 API에 떠 있을 때 쓰는 임시 수단이다(이 모드에서는 프롬프트 버전을 고르지 않으므로 활성 버전 교체도 일어나지 않는다). **프롬프트 버전** 모드는 종전대로 한 노드의 두 버전을 같은 엔드포인트에서 비교한다.

## 내보내기

`GET /api/ragas-runs/{id}/export?fmt=csv` / `…/ab/{groupId}/export?fmt=csv` — **CSV(UTF-8 BOM)만 지원**. 파이썬 전용 라이브러리가 필요하던 xlsx는 제거됨(CSV를 Excel에서 열 것).

## 배포

`deploy.sh [dev|prd]` — inview와 동일 패턴(git reset → npm install → build → prune → `next start -p 5175`). 스크립트 상단의 `GIT_REPO_URL`/`DEPLOY_DIR` 등을 환경에 맞게 수정.

## 라이선스

내부 프로젝트.
