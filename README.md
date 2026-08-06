# AutoPrompt — Prompt Management & RAGAS

AI Agent의 프롬프트/모델 설정을 중앙에서 버전 관리하고, 전체 플로우 단위 **RAGAS 회귀 평가**를 수행하는 웹 시스템. **백엔드 없이 단일 Next.js 14 앱**으로 동작한다(FastAPI 백엔드는 제거되고 로직이 Next.js route handler + `src/lib`로 이식됨).

- Stack: **Next.js 14 (App Router)** + TypeScript + Tailwind(토큰 기반 디자인 시스템)
- DB: **Oracle 19c+** — `oracledb` 드라이버로 직접 접근 (PTX_* 6개 테이블). Docker 미사용, 로컬 직접 설치
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
  baseUrl: ""             # 공용 기본 엔드포인트 (A/B 가 비면 이 값)
  baseUrlA: ""            # 비교 A 쪽 기본 엔드포인트 (단일 실행/단건 호출도 A)
  baseUrlB: ""            # 비교 B 쪽 기본 엔드포인트
  protocol: "chat"        # 요청 형식: chat(기존 채팅 body) | jsonrpc(JSON-RPC 2.0 / A2A)
  protocolA: ""           # A 쪽 요청 형식 (비우면 protocol)
  protocolB: ""           # B 쪽 요청 형식 (비우면 protocol)
  rpcMethod: "message/send"  # protocol=jsonrpc 일 때의 method
  authKey: ""             # 공용 인증 키 (A/B 가 비면 이 값)
  authKeyA: ""            # A 쪽 인증 키
  authKeyB: ""            # B 쪽 인증 키
  userId: "pm-test"
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

마이그레이션 도구 없음. `sql/ddl_initial.sql`을 PTX Oracle 스키마에 직접 적용한다(PTX_* 6개 테이블만 생성; 운영 테이블은 건드리지 않음). DB 미설정 상태로도 UI는 뜨며 조회는 빈 결과가 된다. 컬럼 명세는 `docs/db-schema.md`.

테이블은 `PTX_<대상>_MAS|_DET|_HIS`, 컬럼은 `_ID/_NM/_NO/_CD/_CTN/_YN/_DT/_SCR` postfix 규칙을 따른다. 삭제 순서는 앱이 챙기지 않고 FK의 `ON DELETE CASCADE`/`SET NULL`에 맡긴다 — 데이터셋을 지워도 과거 실행 기록은 남고(`PTX_RUN_MAS.DATASET_NM` 스냅샷), 실행을 지우면 그 결과만 함께 사라진다. 옛 `PM_*` 스키마가 있으면 `sql/migrate_ptx_rename.sql`로 이름을 옮긴다.

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

`src/lib/services/externalAgent.ts`. 엔드포인트마다 요청 형식이 달라서 `agent.protocol`(및 `protocolA`/`protocolB`)로 고른다. 어느 쪽이든 세션 컨텍스트(`CUBE_CHANNEL_ID`/`CUBE_CHANNEL_NM`/`CUBE_USER_ID`/`CUBE_USER_NM`/`TRACE_ID`)가 함께 나가며, `CUBE_USER_ID`는 호출자 사번(`agent.userId` 또는 요청의 `user_id`), `TRACE_ID`는 호출마다 `PM-YYYYMMDD-NNNN`으로 발급된다(일 단위 리셋, 카운터는 프로세스 메모리).

- **`chat`** (기본) — `{message, user_id, session_id, chat_type, a2a_remote_urls, is_super_agent, main_model_name, session_system_prompt}`. `session_system_prompt`는 세션 컨텍스트를 **문자열로 직렬화**한 값이다.
- **`gaia`** — 두 번째 엔드포인트(gaia 게이트웨이)용. 이쪽은 **표준 A2A `message/send`**(JSON-RPC 2.0)라서 `{jsonrpc:"2.0", id, method, params:{message, metadata}}` 구조를 요구한다. `params.message`가 필수이고(빠지면 `-32600 … 1 validation error for SendMessageRequest params.message`) `{role:"user", parts:[{kind:"text", text:<질문>}], messageId, kind:"message"}` 형태다. gaia 고유 필드(`query`, `user_id`, `session_id`, `gaia_session_name`, `gaia_input_channel:"api"`, `chat_type`, `a2a_remote_urls`, `is_super_agent`, `main_model_name`, `session_system_prompt`, `request_url`, `trace_id`)는 `params` 바로 아래에 두면 모델이 거부하므로 **`params.metadata`**에 실어 보낸다. `request_url`은 실제로 호출하는 URL, `trace_id`는 빈 문자열이다(실제 번호는 `session_system_prompt.TRACE_ID`).

응답이 JSON-RPC 봉투(`{jsonrpc, result|error}`)로 오면 `error`는 그대로 실패 처리하고 `result`를 벗겨 `parts[].text`를 이어붙인다.

헤더는 `auth-key`/`user-id`(이름은 `authHeader`/`userHeader`로 변경 가능)이고, 인증 키는 `authKeyA`/`authKeyB`로 A/B를 나눠 줄 수 있다. URL은 설정값 뒤 슬래시만 떼고 **그 주소로 그대로 POST**한다(코드가 `/chat` 같은 경로를 붙이지 않음).

## 진행 스트리밍 (SSE)

RAGAS 실행 진행상황은 WebSocket 대신 **SSE**로 전송된다. `POST /api/flow/test/ragas`가 run(PENDING)을 만들고, 프론트가 `GET /api/ragas-runs/{id}/stream`(EventSource)에 붙으면 그 스트림이 평가 루프를 구동하며 `RUNNING/ANSWER/SCORE/DONE` 이벤트를 흘린다. 취소는 `POST /api/ragas-runs/{id}/cancel`(STATUS=CANCELLING).

스트림에 `?side=a|b` 를 붙이면 그 런은 해당 쪽 기본 엔드포인트(`agent.baseUrlA` / `baseUrlB`)를 호출하고, `?base_url=` 를 함께 주면 그 URL이 우선한다. Compare 탭의 **엔드포인트** 모드가 이 경로로, 두 버전이 서로 다른 API에 떠 있을 때 쓰는 임시 수단이다(이 모드에서는 프롬프트 버전을 고르지 않으므로 활성 버전 교체도 일어나지 않는다). **프롬프트 버전** 모드는 종전대로 한 노드의 두 버전을 같은 엔드포인트에서 비교한다.

## 내보내기

`GET /api/ragas-runs/{id}/export?fmt=csv` / `…/ab/{groupId}/export?fmt=csv` — **CSV(UTF-8 BOM)만 지원**. 파이썬 전용 라이브러리가 필요하던 xlsx는 제거됨(CSV를 Excel에서 열 것).

## 배포

`deploy.sh [dev|prd]` — inview와 동일 패턴(git reset → npm install → build → prune → `next start -p 5175`). 스크립트 상단의 `GIT_REPO_URL`/`DEPLOY_DIR` 등을 환경에 맞게 수정.

## 라이선스

내부 프로젝트.
