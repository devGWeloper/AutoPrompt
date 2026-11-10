# MR Gate 설계 — GitLab MR 자동 승인 (→ prd)

> 상태: **구현 완료, 실환경 미검증** (§14). 켜기 전 설정과 사내 이관 시 할 일은 §15, 채워야 할 값은 §12 참고.

## 1. 목적 / 범위

AI Agent 프로젝트(GitLab)에서 **`prd` 브랜치로 향하는 모든 MR**(출발 브랜치 무관)이 열리면, PTX 에 쌓인 **dev 테스트 이력**을 근거로 봇 계정이 MR 을 **approve** 한다.

| 구분 | 내용 |
|---|---|
| 하는 것 | 열린 MR 조회 → 테스트 이력 평가 → (통과) approve / (불통과) 사유 코멘트 |
| 안 하는 것 | **Merge 는 사람이 한다.** 봇은 approve 만 한다 |
| 대상 | 현재 **Agent 1개 = GitLab 프로젝트 1개**. 그 프로젝트에서 `prd` 로 오는 **열린 MR 전부**를 각각 독립적으로 판정. 프로젝트 확장은 추후 |
| 별도 서비스 | 없음. **기존 Next.js 프로세스 안에서** 동작 (prd 서버 1대만) |
| DB 쓰기 | **없음.** 상태는 GitLab 이 갖고, 이력은 서버 로그에만 남긴다. DB 는 읽기 전용(`PTX_RUN_MAS`, `PTX_RUN_DET`) |
| UI | 이번 범위 밖. 기존 UI 와 코드 의존 없음 |

## 2. 핵심 결정 사항

| # | 결정 | 이유 |
|---|---|---|
| 1 | **5분 주기 Batch 가 진실의 원천**. webhook 은 "지금 한 번 돌려라" 트리거일 뿐 | webhook 페이로드를 아직 확정 못 함. 테스트가 MR 이후에 끝나도 다음 tick 에 자연히 재평가됨 |
| 2 | 통과 기준 = **지정 데이터셋의 가장 최근 single run 1건이 전체 통과**, 그리고 그 run 이 **최신 커밋 이후**에 시작됨 | 요구사항 |
| 3 | 시각 비교는 `START_TM` vs head 커밋 `committed_date` (커밋 시각만 본다) | 요구사항 |
| 4 | **Dry-run 기본값 ON**: approve 대신 "승인 가능" 코멘트만 | 정책 검증 후 전환 |
| 5 | 토큰/시크릿도 **`config.yml`** 에 둔다 | 기존 DB 비밀번호와 같은 방식. 리포 커밋 주의사항은 §4.2 |
| 6 | `gate.batchEnabled` 기본 `false`, **prd 서버에서만 `true`**. 배치(타이머)만 켜고 끄며 gate 전체 스위치는 없다 | dev/로컬이 같은 DB·GitLab 을 보면 이중 승인·이중 코멘트. webhook / 수동 실행 API 는 `secret` 만 있으면 동작 |
| 7 | **신규 테이블 없음** | "이미 승인했는가" = GitLab approvals, "이미 코멘트했는가" = MR notes, 이력 = 서버 로그. 상세는 §5 |

## 3. 아키텍처

```
                        ┌──────────── Next.js 프로세스 (prd 서버 1대) ────────────┐
GitLab ──(MR event)──▶  │ POST /api/gitlab/webhook ─┐                              │
curl(운영자) ─────────▶ │ POST /api/gate/run  ──────┼──▶ runGateTick() (재진입 방지)│
                        │ instrumentation.ts        │          │                   │
                        │   setInterval(5분) ───────┘          ▼                   │
                        │                          src/lib/gate/*                  │
                        │                           ├ gitlabClient  ──▶ GitLab API │
                        │                           ├ evidence      ──▶ Oracle     │
                        │                           ├ policy (순수 함수)            │
                        │                           └ logger (이력은 로그만)       │
                        └──────────────────────────────────────────────────────────┘
```

- `runGateTick()` 은 어느 경로로 호출되든 **동시에 1개만** 실행 (프로세스 내 진행 플래그). 겹치면 스킵.
- 단일 프로세스 전제라 DB 락은 두지 않는다. 멀티 인스턴스로 바꾸게 되면 그때 락 추가.

### 3.1 기동 방식

- `src/instrumentation.ts` 의 `register()` 에서 `NEXT_RUNTIME === 'nodejs'` 일 때만 `await import('./lib/gate/scheduler')` (Edge 번들에 `oracledb` 가 섞이면 빌드가 깨짐).
- Next 14.2 는 `next.config.mjs` 에 `experimental.instrumentationHook: true` 필요.
- `globalThis.__gateTimer` 로 타이머 **중복 등록 방지** (dev HMR 대비).
- `gate.batchEnabled=false` 면 타이머를 아예 만들지 않는다 (webhook / 수동 실행은 영향 없음).
- 기동 직후 즉시 실행하지 않고 첫 tick 은 interval 후. 필요하면 `/api/gate/run` 으로 수동 실행.

## 4. 설정

### 4.1 `config.yml`

```yaml
gate:
  batchEnabled: false         # 5분 배치(타이머)만 on/off. prd 서버에서만 true
  dryRun: true                # true = approve 안 하고 코멘트만
  comment: true               # false = 코멘트 게시 안 함 (로그만)
  intervalSec: 300            # 5분
  secret: ""                  # webhook(X-Gitlab-Token) / 수동 실행(X-Gate-Secret) 공유 시크릿
  gitlab:
    baseUrl: "https://gitlab.example.com"   # 사내 GitLab
    token: ""                 # 봇 계정 Project Access Token (api scope)
    timeoutSec: 15
  projects:                   # 현재 1개. 추후 Agent 가 늘면 여기에 항목 추가
    - gitlabProjectId: ""     # 숫자 ID 또는 URL-encoded path
      sourceBranch: ""          # 비우면 targetBranch 로 오는 모든 MR 이 대상. 값을 주면 그 브랜치에서 온 MR 만
      targetBranch: "prd"
      datasetId: 0            # 평가 대상 데이터셋 (고정)
```

### 4.2 토큰 취급 주의

- `config.yml`/`config.dev.yml` 은 리포에 커밋되고 `deploy.sh` 가 `git reset` 으로 배포한다. 토큰은 **리포 읽기 권한이 있는 모든 사람과 git 이력에 노출**된다. (기존 `db.password` 와 같은 수준의 취급.)
- 이 토큰으로 MR 승인·코멘트가 가능하므로, 노출 피해를 줄이기 위해:
  - 봇을 **해당 프로젝트에만** 멤버로 추가, 역할은 승인 가능한 최소 권한 (Developer 이상 중 Approval Rule 요건에 맞는 것)
  - Project Access Token 사용 + **만료일 설정**
  - 노출 의심 시 토큰만 재발급하면 되므로 교체 절차를 알아 둘 것
- 로그에는 토큰/시크릿을 절대 출력하지 않는다 (요청 헤더 마스킹).
- dev 용 `config.dev.yml` 에는 토큰을 넣지 않는다 (`gate.batchEnabled: false` 유지 → 이중 실행 방지와 동시에 토큰 노출면 축소).

## 5. 상태 관리 — 신규 테이블 없이

기존에 별도 테이블이 맡을 예정이던 역할을 아래처럼 대체한다.

| 필요한 것 | 대체 수단 |
|---|---|
| 이미 승인했는가 | `GET …/approvals` 의 `approved_by` 에 봇이 있는가 |
| 같은 코멘트 중복 방지 | `GET …/notes` 에서 **봇이 쓴 최신 `[MR Gate]` 코멘트**를 찾아, 숨은 마커(`<!-- gate:KEY -->`)의 `KEY` 와 비교. `KEY = sha｜decision｜reasonCd｜runId` |
| Dry-run → 실모드 전환 | 승인 여부를 GitLab 에서 읽으므로 상태 이전 불필요. 실모드로 켜면 다음 tick 에 자연히 approve |
| 이력 기록 | **DB 에 쓰지 않고** 기존 `logger` 로 로그만 남긴다. 행동이 일어난 때(approve / 코멘트 게시)와 판정이 바뀔 때 1줄씩: `project`, `mr`, `sha`, `decision`, `reason`, `runId`, 실패 케이스 ID 요약. 토큰/시크릿은 찍지 않는다 |
| 봇 식별 | 기동 후 첫 tick 에서 `GET /user` 로 봇 user id 확인 후 메모리에 캐시 |

**감수하는 것**
- FAIL/WAIT 판정의 이력은 DB 에 남지 않는다 (코멘트와 서버 로그에만). 필요해지면 그때 테이블 추가.
- 매 tick 에 notes 조회 1회가 추가된다 (5분 주기라 무시 가능).
- `comment: false` 면 코멘트 중복 방지가 필요 없고, 이력은 로그에만 남는다.

**GitLab 사전 조건 (중요)**
- 프로젝트 설정에서 **"새 커밋이 push 되면 승인 초기화(Remove all approvals when commits are added)" 를 켜야 한다.** approvals API 로는 *어느 커밋에 대한 승인인지* 알 수 없어서, 이 설정이 꺼져 있으면 봇이 옛 커밋에 한 승인이 새 커밋에도 남아 게이트가 우회된다.
- 봇은 해당 프로젝트 멤버이며 Approval Rule 의 eligible approver, MR 작성자와 다른 계정.

## 6. Tick 처리 흐름

```
runGateTick():
  if 진행중 → return
  for p in gate.projects:
    1. GET MR 목록 (opened, target=prd[, source])        → 없으면 다음 프로젝트
       이하 2~7 을 **열린 MR 마다 독립적으로** 수행 (한 MR 실패가 다른 MR 을 막지 않음)
    2. MR 상세: draft / has_conflicts / sha             → draft·충돌이면 SKIP (로그만)
    3. head 커밋 상세: committed_date
    4. GET approvals: 봇이 이미 승인했으면 → 종료
    5. evidence 조회 + policy 평가                        → decision / reasonCd
    6. 결과 처리
         PASS : dryRun ? 코멘트("승인 가능 (dry-run)")
                       : approve(sha) + 코멘트("승인") → 로그
         FAIL / WAIT : approve 안 함, 코멘트
         ERROR: 로그만, 다음 tick 재시도
    7. 코멘트는 comment=true 이고 KEY 가 마지막 [MR Gate] 코멘트와 다를 때만 게시 → 로그
```

- 새 커밋 push → `sha` 가 바뀌어 `KEY` 가 달라지고 처음부터 재평가. §5 사전 조건 덕에 이전 승인은 GitLab 이 리셋.
- `approve` 는 **평가한 sha 를 `sha` 파라미터로 전달**해, 평가 후 push 된 커밋이 승인되는 것을 막는다 (불일치 시 GitLab 이 거부 → 다음 tick 에 재평가).

## 7. 평가 정책

### 7.1 대상 run 선택

```sql
SELECT RUN_ID, STATUS_CD, START_TM, ...
  FROM PTX_RUN_MAS
 WHERE DATASET_ID = :datasetId
   AND AB_GROUP_ID IS NULL                 -- single run 만
 ORDER BY START_TM DESC
 FETCH FIRST 1 ROWS ONLY
```

"최신 1건" 이 대상이다. 과거에 통과한 run 이 있어도 **가장 최근 run 이 실패면 불통과**다.

### 7.2 판정 (위에서부터 순서대로, 처음 걸리는 것이 결과)

| 순서 | 조건 | DECISION | REASON_CD |
|---|---|---|---|
| 1 | 해당 데이터셋 run 없음 | FAIL | `NO_RUN` |
| 2 | `START_TM` ≤ 커밋 시각 | FAIL | `STALE_RUN` (커밋 이후 테스트 없음) |
| 3 | `STATUS_CD` in (PENDING, RUNNING, CANCELLING) | WAIT | `RUN_IN_PROGRESS` |
| 4 | `STATUS_CD` in (FAILED, CANCELLED) | FAIL | `RUN_NOT_DONE` |
| 5 | 불통과 케이스 존재 | FAIL | `CASE_FAILED` (건수 + 앞 N개 `CASE_ID`) |
| 6 | 그 외 | PASS | `ALL_PASSED` |

**케이스 통과 정의**: `EXACT_VAL = 1` **또는** `PASS_YN = 'Y'` (수동 통과 처리) 이고 `ERROR_CTN` 이 비어 있음.
`PASS_YN` 컬럼은 마이그레이션 적용 여부에 따라 없을 수 있으므로 기존 코드의 `hasColumn` 패턴으로 확인하고, 없으면 `EXACT_VAL` 만 본다.

> 정답지 없는 케이스는 없다는 전제이므로 `EXACT_VAL IS NULL` 은 **불통과**로 취급한다 (안전한 쪽).
> RAGAS 지표는 이번 범위에서 보지 않는다. 케이스 수 일치 검증도 하지 않는다 (요구사항).

### 7.3 시각 비교

`START_TM` 은 타임존 없는 `TIMESTAMP` 로, DB 가 `SYSTIMESTAMP` 로 찍은 **DB 서버 벽시계 값**이다 (`flow.ts`). 단순 비교로 간다.

- GitLab `committed_date`(ISO8601, 오프셋 포함) 를 JS `Date` 로 파싱한 뒤 **앱 서버 로컬 시각**의 `YYYY-MM-DD HH24:MI:SS` 문자열로 만들어 SQL 에 바인드:

```sql
START_TM > TO_TIMESTAMP(:commitLocal, 'YYYY-MM-DD HH24:MI:SS')
```

- **전제: 앱 서버와 DB 서버의 타임존이 같다** (둘 다 KST 등). 다르면 판정이 시간 단위로 어긋난다. 구현 후 `SELECT SYSTIMESTAMP FROM DUAL` 과 앱 서버 `date` 를 1회 비교해 확인한다 (§11-2).
- 커밋 시각은 초 단위, `START_TM` 은 소수 초라 경계는 `>` (엄격 초과)로 비교.
- `START_TM` 은 "가장 최근 실행 구간" 이라 불일치 재실행 때 다시 찍힌다. 재실행도 최신 실행으로 보고 그 시각으로 판정한다.

## 8. GitLab API 목록

모두 `PRIVATE-TOKEN: <gate.gitlab.token>` 헤더, `/api/v4` 기준.

| 용도 | 호출 |
|---|---|
| 봇 식별 | `GET /user` — 봇 user id (기동 후 1회) |
| 열린 MR 조회 | `GET /projects/:id/merge_requests?state=opened&target_branch=prd&per_page=100` (`sourceBranch` 를 설정한 경우에만 `&source_branch=…` 추가) |
| MR 상세 | `GET /projects/:id/merge_requests/:iid` — `sha`, `draft`, `has_conflicts` |
| head 커밋 시각 | `GET /projects/:id/repository/commits/:sha` — `committed_date` |
| 승인 상태 | `GET /projects/:id/merge_requests/:iid/approvals` — 봇의 기승인 여부 |
| **승인** | `POST /projects/:id/merge_requests/:iid/approve` (`sha` 파라미터) — **상세 스펙은 추후 기재** |
| 코멘트 조회 | `GET /projects/:id/merge_requests/:iid/notes?order_by=created_at&sort=desc&per_page=20` — 중복 방지용 |
| 코멘트 | `POST /projects/:id/merge_requests/:iid/notes` (`body`) |

- 5xx/타임아웃은 해당 tick 에서 `ERROR` 로그 후 다음 tick 에 재시도. 4xx(401/403) 는 설정 오류이므로 에러 로그를 명확히 남긴다.

## 9. webhook / 수동 실행

| 엔드포인트 | 역할 | 인증 |
|---|---|---|
| `POST /api/gitlab/webhook` | MR event 수신 → `object_kind==='merge_request'` 이면 tick 을 **비동기로 즉시 1회 트리거**하고 바로 200 반환 | `X-Gitlab-Token === gate.secret` |
| `POST /api/gate/run` | 운영자 수동 실행. 결과 요약 JSON 반환 | `X-Gate-Secret === gate.secret` |

- **페이로드 내용은 신뢰하지 않는다.** 트리거로만 쓰고, 판단 근거는 항상 GitLab API 재조회 결과.
- 여러 번 와도 진행 플래그와 디바운스(최소 간격 10초)로 1회만 실행.
- webhook 이 없어도 시스템은 완전히 동작한다 (최악의 경우 5분 지연).
- 앱 전역에 인증이 없으므로(`README`) 두 엔드포인트만 시크릿 필수. `gate.secret` 이 비어 있으면 **엔드포인트 비활성(403)**. 배치 스위치(`batchEnabled`)와는 무관하다.

## 10. 코멘트 형식 (간단히)

```
[MR Gate] 승인 가능 (dry-run) — run #123 전체 통과 (42/42)
[MR Gate] 승인 — run #123 전체 통과 (42/42)
[MR Gate] 대기 — run #123 진행 중
[MR Gate] 불통과 — 최신 커밋(2026-11-09 10:12) 이후 테스트 없음
[MR Gate] 불통과 — run #123 실패 3건 (case 11, 15, 27)
<!-- gate:abc123|FAIL|CASE_FAILED|123 -->
```

마지막 줄의 숨은 마커는 중복 방지용(§5)이며 화면에는 보이지 않는다. `comment: false` 로 끌 수 있다.

## 11. 파일 구성 / 검증

```
src/instrumentation.ts            기동 시 scheduler 등록 (nodejs 런타임만)
src/app/api/gitlab/webhook/route.ts
src/app/api/gate/run/route.ts
src/lib/gate/
  scheduler.ts      타이머 등록, 중복 방지
  tick.ts           runGateTick() — §6 흐름
  gitlabClient.ts   §8 호출 래퍼 (타임아웃, 토큰 마스킹)
  evidence.ts       run / 케이스 판정 조회 (SQL, §7)
  policy.ts         순수 함수: (evidence, commitTime) → decision
  auth.ts           webhook / 수동 실행 시크릿 검증
  time.ts           커밋 시각 → 서버 로컬 시각 문자열
docs/gate-design.md (이 문서)
```

`sql/` 마이그레이션은 없다. `policy.ts` 는 DB/HTTP 의존이 없어 단위 테스트가 쉽다. 기존 `src/lib/config.ts` 로더, `db.ts`, `logger.ts` 를 재사용한다. **DB 는 읽기만 하고 쓰지 않는다.**

**검증 계획**
1. **단위**: `policy.ts` — 판정표(§7.2) 각 행 + 경계(`START_TM` == 커밋 시각).
2. **타임존**: 앱 서버와 DB 서버 시각/타임존 일치 확인, 실제 run 1건과 방금 한 커밋으로 `START_TM >` 비교 1회 확인.
3. **Dry-run 운영**: 며칠간 코멘트만 남기며 "승인 가능" 판정이 사람의 판단과 일치하는지 확인.
4. **실모드 전환**: 테스트 MR 1건으로 approve 동작 + `sha` 불일치 시 거부 + **새 커밋 push 시 승인 초기화** 동작 확인 → `dryRun: false`.
5. **이중 실행 방지**: dev/로컬에서 `gate.batchEnabled` 기본 false 인지, 기동 로그에 "gate batch off" 가 찍히는지 확인.

## 12. 채울 값 / 미결

| 항목 | 상태 |
|---|---|
| `datasetId` | 추후 입력 (config 고정값) |
| `gitlabProjectId`, `baseUrl`, 봇 토큰 | 추후 입력 (`config.yml`) |
| approve API 상세 | 사용자가 추후 기재 |
| GitLab 이 사내 CA/self-signed 인증서인 경우 | 서버 기동 환경에 `NODE_EXTRA_CA_CERTS=<CA 파일>` 지정 (앱에는 TLS 검증 해제 옵션을 두지 않음) |
| GitLab "새 커밋 시 승인 초기화" 설정 | **확인 필요** (§5 사전 조건) |
| 앱 서버 ↔ DB 서버 타임존 동일 여부 | 확인 필요 (§7.3) |
| webhook 페이로드 | 미확인 — 트리거로만 쓰므로 구현에 영향 없음 |

## 13. 추후 확장 (이번 범위 아님)

- 판정/승인 이력 DB 보관이 필요해지면 신규 테이블 추가 (예: `PTX_MR_GATE_HIS` — 판정 결과 + 근거 JSON). 필요 시점에 별도 설계.
- Agent 가 늘면: `PTX_RUN_MAS` 와 프로젝트의 매핑 필요 (`ENDPOINT_NM` 또는 데이터셋 기준). 현재 `projects[]` 배열 구조는 이를 위해 열어 둠.
- 케이스 수 일치 검증, RAGAS 임계치, 기준선 대비 회귀 검사는 `policy.ts` 에 규칙 추가로 확장.
- 승인 후 재평가에서 실패 시 `unapprove`.
- 상태 확인용 UI / 읽기 전용 `GET /api/gate/status`.

## 14. 구현 현황 (2026-11-09 기준)

### 14.1 결과

설계(§1~§11)대로 구현했다. 기본값은 `gate.batchEnabled: false`, `gate.dryRun: true` 이며, 배치가 꺼져 있으면 타이머가 만들어지지 않는다. 엔드포인트(webhook / 수동 실행)는 `gate.secret` 이 설정돼 있으면 배치 스위치와 무관하게 동작한다. (gate 전체 on/off 스위치는 두지 않는다.)

**호출 경로**: `src/instrumentation.ts` → `lib/gate/scheduler.ts`(5분 타이머) → `lib/gate/tick.ts` (`runGateTick` → `processProject` = 전체 흐름). webhook(`/api/gitlab/webhook`)은 판단하지 않고 `triggerGate()` 로 tick 을 앞당겨 실행시키기만 한다.

### 14.2 설계 대비 달라진 점 (설계 논의 중 변경 포함)

| 항목 | 최초 설계 | 현재 |
|---|---|---|
| 신규 테이블 | `PTX_MR_GATE_HIS` | **없음.** 승인 여부는 GitLab approvals, 코멘트 중복은 MR notes 의 숨은 마커로 판단 |
| 이력/감사 | `PTX_AUDIT_HIS` | **서버 로그만.** DB 에는 쓰지 않음 (읽기 전용: `PTX_RUN_MAS`, `PTX_RUN_DET`). 필요해지면 신규 테이블 추가 |
| 토큰/시크릿 | 환경변수 | **`config.yml`** (`gate.gitlab.token`, `gate.secret`). 리포 커밋 주의는 §4.2 |
| 시각 비교 | `FROM_TZ` 로 DB 오프셋 보정 | 단순 비교: 커밋 시각을 **앱 서버 로컬 시각** 문자열로 바꿔 `START_TM > TO_TIMESTAMP(…)`. **앱 서버와 DB 서버의 타임존이 같다는 전제** |
| TLS | `insecureTls` 옵션 | 옵션 제거. 사내 CA 면 `NODE_EXTRA_CA_CERTS` 로 처리 |
| 프로세스 상태 | 모듈 변수 | **`globalThis`** 에 보관 — Next 가 instrumentation 과 라우트 핸들러를 따로 번들해서 모듈 변수는 공유되지 않음 |
| 정답지 없는 케이스 | (미정) | `EXACT_VAL IS NULL` 은 **불통과** |
| 대기 중 run | (미정) | `START_TM` 이 아직 없는 PENDING run 은 STALE 이 아니라 **WAIT** |
| run 선정 정렬 | `START_TM DESC` | `NVL(START_TM, CRT_TM) DESC, RUN_ID DESC` (START_TM 이 NULL 인 대기 run 을 맨 위로) |
| 대상 MR | `dev → prd` 1건 | **`prd` 로 오는 모든 열린 MR** (출발 브랜치 무관, `sourceBranch` 로 좁힐 수 있음). MR 마다 독립 판정·독립 코멘트·독립 로그 |
| 첫 tick | — | 기동 직후가 아니라 **interval 후** (재배포 직후 오동작 방지) |
| `comment: false` | — | 코멘트를 안 달고 로그만 남김 (config 키 추가) |

### 14.3 변경된 기존 파일 (그 외 기존 코드는 수정 없음)

| 파일 | 변경 |
|---|---|
| `src/lib/config.ts` | `gate` 설정 타입/정규화/`getGateConfig()` 추가. 기존 필드·시작 로그는 그대로이고 gate 값(토큰)은 로그에 찍지 않음 |
| `next.config.mjs` | `experimental.instrumentationHook: true` 한 줄 추가 |
| `config.yml`, `config.dev.yml` | `gate:` 섹션 추가 (둘 다 `batchEnabled: false`, `dryRun: true`) |

신규: `src/instrumentation.ts`, `src/lib/gate/*`(policy, evidence, gitlabClient, tick, scheduler, auth, time), `src/app/api/gitlab/webhook/route.ts`, `src/app/api/gate/run/route.ts`, 이 문서. UI·기존 API·DB 스키마는 건드리지 않았다.

### 14.4 동작상 중요한 점

- **판정**: 지정 `datasetId` 의 가장 최근 single run(`AB_GROUP_ID IS NULL`) 1건만 본다. 과거에 통과한 run 이 있어도 최신 run 이 실패면 불통과. 불일치 재실행은 `START_TM` 을 다시 찍으므로 재실행 시각이 기준이 된다.
- **승인은 평가한 sha 에 고정**: `approve` 에 `sha` 를 실어 보내므로 평가 후 push 된 커밋은 GitLab 이 거부하고 다음 tick 에 재평가한다.
- **새 커밋 후 재승인 방지는 GitLab 설정에 의존**: "새 커밋 push 시 승인 초기화"가 꺼져 있으면 옛 승인이 새 커밋에 남는다 (§5). 이 서버는 이를 검증하지 않는다.
- **코멘트 중복 방지**는 메모리가 아니라 GitLab 에 남은 마커로 판단하므로 서버를 재시작해도 같은 코멘트가 다시 달리지 않는다. 재시작 후에는 로그의 `gate: verdict` 줄이 한 번 다시 찍힐 뿐이다.
- **로그 규칙**: 같은 상태는 다시 찍지 않고 판정이 바뀔 때만 info. 에러는 tick 마다 찍힌다. 토큰·시크릿·케이스 본문은 로그에 없다 (`CASE_ID` 만).
- **`prd` 로 오는 모든 MR 이 대상**: 출발 브랜치와 무관하게 열린 MR 을 전부 각각 판정한다 (`sourceBranch` 를 비워 둔 기본값). 목록은 한 페이지(100건)만 읽고, 꽉 차면 경고 로그를 남긴다.
- **판정 근거는 MR 과 무관하게 같다**: 근거는 지정 `datasetId` 의 최신 run 하나이므로 MR 이 여러 개면 각 MR 의 head 커밋 시각만 다르게 비교될 뿐 같은 run 이 근거가 된다. 즉 **어떤 브랜치에서 온 MR 이든 "그 데이터셋의 최신 테스트가 자기 최신 커밋 이후에 통과했는가"** 만 본다. 테스트가 해당 MR 의 코드로 돌았는지는 확인하지 않는다.
- **엔드포인트 보호**: `gate.secret` 이 비어 있으면 `/api/gitlab/webhook`, `/api/gate/run` 은 항상 403. 점검 실행에는 `gitlab.baseUrl` / `token` / `projects` 설정도 필요하다 (없으면 `ran: false`, "not configured").

### 14.5 검증 상태

| 항목 | 상태 |
|---|---|
| `npm run typecheck`, `npm run build` | 통과 |
| 판정 로직(`policy.ts`) 전 분기, 시각 변환 | 임시 스크립트로 확인 (저장소에 테스트 러너가 없어 테스트 파일은 커밋하지 않음) |
| 배치 꺼진 상태(구 `enabled: false` 시점)로 서버 기동 | 확인: 두 엔드포인트 403(secret 비어 있음), `/api/health` 정상. `batchEnabled` 로 바꾼 뒤에는 기동 로그 `gate batch off` 로 재확인 필요 |
| **실제 GitLab 호출 (MR 조회/커밋/approvals/notes/approve)** | **미검증** |
| **Oracle 에서 run/케이스 조회 SQL** | **미검증** (DB 미연결 환경) |
| **webhook 수신 (GitLab → 서버)** | **미검증** |
| **타임존 일치** | **미검증** |
| approve 호출 형식 | GitLab 표준(`POST …/approve`, 본문 `{"sha": …}`)으로 구현. 사용 중인 GitLab 에서 확인 필요 |

## 15. 사내 이관 시 설정 / 체크리스트

### 15.1 서버(prd) 쪽

| # | 할 일 | 비고 |
|---|---|---|
| 1 | `config.yml`(prd 브랜치)의 `gate:` 채우기 | `gitlab.baseUrl`, `gitlab.token`, `secret`, `projects[].gitlabProjectId`, `projects[].datasetId` |
| 2 | **`gate.batchEnabled: true` 는 prd 서버의 `config.yml` 에만** | `config.dev.yml` 은 `false` 유지. 두 서버가 동시에 켜지면 이중 승인·이중 코멘트. `deploy.sh prd` 는 `config.dev.yml` 을 지우므로 `config.yml` 값이 쓰인다 |
| 3 | 처음엔 `dryRun: true` | 코멘트("승인 가능 (dry-run)")만 남는다. 며칠 판정을 사람 판단과 비교한 뒤 `false` |
| 4 | **앱 서버 ↔ DB 서버 타임존 확인** | 앱 서버 `date`, DB `SELECT SYSTIMESTAMP FROM DUAL`. 다르면 판정이 시간 단위로 어긋난다 (§7.3) |
| 5 | prd 서버 → GitLab 네트워크 | `gate.gitlab.baseUrl` 로 HTTP(S) 접근 가능해야 함. **Node `fetch` 는 `HTTP_PROXY` 환경변수를 쓰지 않으므로** 프록시 경유 GitLab 은 지원하지 않는다 (사내 직접 접근 전제) |
| 6 | GitLab → prd 서버 방화벽 | webhook 을 쓰려면 GitLab 서버에서 prd `5175` 포트 접근 허용. 막혀 있어도 5분 tick 으로 동작한다 |
| 7 | 사내 CA / self-signed 인증서면 `NODE_EXTRA_CA_CERTS=<CA 파일>` | **`deploy.sh` 의 `nohup next start` 실행 환경에 export** 되어야 한다 (deploy.sh 수정 필요할 수 있음). 앱에는 TLS 검증 해제 옵션이 없음 |
| 8 | DB 계정 권한 | 기존 접속 계정이 `PTX_RUN_MAS`, `PTX_RUN_DET` 을 읽을 수 있으면 충분 (gate 는 쓰기 없음) |
| 9 | `PASS_YN` 마이그레이션 적용 여부 | `sql/migrate_run_det_pass.sql`. 없으면 수동 통과 처리가 반영되지 않고 `EXACT_VAL=1` 만 통과로 본다 (코드가 컬럼 유무를 자동 판별) |
| 10 | 배포 | `./deploy.sh prd`. 새 의존성 없음. 서버 재시작 시 gate 도 같이 재시작 |
| 11 | 배포 후 확인 | `app.log` 에 `gate scheduler started` (또는 `gate batch off`). 이어서 `curl -X POST http://<host>:5175/api/gate/run -H "X-Gate-Secret: <secret>"` 로 1회 수동 실행해 응답의 `outcomes` 확인 |
| 12 | **로그 보존** | `deploy.sh` 는 `nohup … > app.log` 로 **재배포할 때마다 로그를 덮어쓴다.** gate 이력이 로그에만 남으므로 보존이 필요하면 `>>` 로 바꾸거나 별도 로테이션 구성 |

### 15.2 GitLab 쪽

| # | 할 일 | 비고 |
|---|---|---|
| 1 | **봇 계정** 준비, 대상 Agent 프로젝트 멤버로 추가 | MR 작성자와 다른 계정. 해당 프로젝트에만 권한 부여 |
| 2 | **Project Access Token (`api` scope)** 발급 + **만료일 설정** | `config.yml` 의 `gate.gitlab.token`. 만료 전 교체 일정 관리. 이 토큰은 리포에 커밋된다 (§4.2) |
| 3 | **Approval Rule 에서 봇이 eligible approver** 인지 확인 | 필요 승인 수가 봇 1명으로 충족되는지, 사람 승인도 필요한지는 정책에 따라 결정 |
| 4 | **"새 커밋이 push 되면 승인 초기화" 설정 ON** | 필수. 꺼져 있으면 게이트 우회 (§5). GitLab 쪽 설정이며 서버는 검증하지 않는다 |
| 5 | **Webhook 등록**: Settings → Webhooks | URL `http://<prd 서버>:5175/api/gitlab/webhook`, Secret token = `gate.secret`, Trigger = **Merge request events** 만. HTTP 를 쓰면 SSL verification 해제 |
| 6 | Merge 는 사람이 한다 | 봇은 approve 만 한다 |
| 7 | approve API 확인 | 사용 중인 GitLab 버전에서 `POST /projects/:id/merge_requests/:iid/approve` + `sha` 파라미터 동작 확인 (구현은 표준 형태) |

### 15.3 켜기 전 최종 점검 순서

1. 위 15.1 #1~#4, 15.2 #1~#4 완료 → `batchEnabled: true`, `dryRun: true` 로 배포
2. 로그에 `gate scheduler started` 확인, `/api/gate/run` 수동 실행으로 GitLab 호출·DB 조회가 에러 없이 도는지 확인
3. 테스트 MR 로 판정 확인: 테스트 이력 없음 → "불통과", 최신 커밋 이후 테스트 통과 → "승인 가능 (dry-run)", 커밋 후 새 커밋 push → 다시 평가
4. 15.2 #5 webhook 등록 후 MR 이벤트에서 즉시 실행되는지 확인 (없어도 5분 내 동작)
5. dry-run 판정이 사람 판단과 며칠 일치하면 `dryRun: false` → 테스트 MR 로 실제 approve 확인, **새 커밋 push 시 승인이 초기화되는지** 확인
6. 문제 시 `gate.batchEnabled: false` 로 바꿔 재배포하면 배치가 중단된다 (이미 한 승인은 GitLab 에서 직접 취소). webhook / 수동 실행까지 막으려면 GitLab 의 webhook 을 끄거나 `gate.secret` 을 비운다.

### 15.4 알려진 제약

- Agent 가 여러 개가 되면 run 과 프로젝트의 매핑(`ENDPOINT_NM` 등)이 필요하다 (§13). 현재는 `datasetId` 하나로만 구분한다.
- 프록시를 거치는 GitLab 은 지원하지 않는다.
- 판정/승인 이력은 로그와 GitLab 코멘트·승인 기록에만 있다. DB 이력이 필요하면 신규 테이블 추가.
- 서버 1대, 단일 프로세스 전제. 다중 인스턴스로 바꾸면 중복 실행 방지(락)를 추가해야 한다.
