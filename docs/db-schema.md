# PTX DB 스키마 (Oracle 19c+)

Prompt Trace eXplorer(PTX) 소유 테이블 8개. 외부 테이블(`CHAT_VER_MAS` / `NODE_MAS` / `MODEL_MAS`)에 대한 FK 없음.
노드 식별자는 `NODE_NM` 문자열이고 별도 노드 마스터 테이블은 없다.

실행용 DDL은 **`sql/ddl_initial.sql`**(권위 스키마)에 있다. 이 문서는 컬럼 명세만 담는다.

## 명명 규칙

- 테이블: `PTX_` + 대상 + `_MAS`(마스터) / `_DET`(상세) / `_HIS`(이력)
- 컬럼 postfix: `_ID`(식별자) `_NM`(명) `_NO`(번호) `_CD`(코드) `_CTN`(내용) `_YN`(여부) `_TM`(일시) `_VAL`(값)
- 테이블명이 이미 말해주는 단어는 컬럼에서 뺀다 (`PTX_PROMPT_HIS.SYSTEM_CTN`)

| 테이블             | 역할                    | PK          | FK                                                              |
|-------------------|------------------------|-------------|-----------------------------------------------------------------|
| `PTX_PROMPT_HIS`  | 노드별 프롬프트 버전      | `PROMPT_ID` | `PREV_PROMPT_ID` → 자기 자신                                      |
| `PTX_DATASET_MAS` | 평가 데이터셋            | `DATASET_ID`| —                                                                |
| `PTX_DATASET_DET` | 데이터셋 케이스          | `CASE_ID`   | `DATASET_ID` → `PTX_DATASET_MAS`                                 |
| `PTX_RUN_MAS`     | 평가 실행 1건 (단일/AB)  | `RUN_ID`    | `PROMPT_ID` → `PTX_PROMPT_HIS`, `DATASET_ID` → `PTX_DATASET_MAS` |
| `PTX_RUN_DET`     | 케이스별 결과            | `RESULT_ID` | `RUN_ID` → `PTX_RUN_MAS`, `CASE_ID` → `PTX_DATASET_DET`          |
| `PTX_AUDIT_HIS`   | 변경 감사 로그           | `LOG_ID`    | 없음 (`TARGET_TABLE_NM`+`TARGET_ID`만 기록)                        |
| `PTX_TRACE_HIS`   | 호출 중 중간 변수         | `TRACE_SEQ_ID` | 없음 (**에이전트가 쓰고 PTX가 읽는** 유일한 테이블)                 |
| `PTX_MODEL_MAS`   | LLM role 별 모델         | `MODEL_ID`  | 없음 (**PTX가 쓰고 에이전트가 읽는다** — join key `ROLE_CD`)        |

---

## PTX_PROMPT_HIS

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `PROMPT_ID` | NUMBER | N | IDENTITY | PK |
| `NODE_NM` | VARCHAR2(200) | N | — | 노드 식별자 |
| `VERSION_NO` | VARCHAR2(20) | N | — | UQ(`NODE_NM`, `VERSION_NO`) |
| `SYSTEM_CTN` | CLOB | Y | — | system 프롬프트 |
| `USER_CTN` | CLOB | Y | — | user 프롬프트 |
| `MODEL_NM` | VARCHAR2(100) | Y | — | |
| `ACTIVE_YN` | VARCHAR2(1) | Y | 'N' | 테스트 실행 중에만 일시적으로 'Y' (상시 활성 버전 개념 없음) |
| `SUMMARY_CTN` | VARCHAR2(500) | Y | — | 변경 요약 |
| `REASON_CTN` | VARCHAR2(1000) | Y | — | 변경 사유 |
| `PREV_PROMPT_ID` | NUMBER | Y | — | FK → `PTX_PROMPT_HIS(PROMPT_ID)` |
| `USER_ID` | VARCHAR2(50) | N | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |
| `UPDATE_TM` | TIMESTAMP | Y | — | |

## PTX_DATASET_MAS

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `DATASET_ID` | NUMBER | N | IDENTITY | PK |
| `DATASET_NM` | VARCHAR2(200) | N | — | |
| `DESC_CTN` | VARCHAR2(500) | Y | — | 설명 |
| `ACTIVE_YN` | VARCHAR2(1) | Y | 'Y' | 'N' = 내부용(수동 호출 기록용 sink)이라 목록에서 숨김 |
| `USER_ID` | VARCHAR2(50) | N | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PTX_DATASET_DET

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `CASE_ID` | NUMBER | N | IDENTITY | PK |
| `DATASET_ID` | NUMBER | N | — | FK → `PTX_DATASET_MAS` |
| `INPUT_CTN` | CLOB | N | — | JSON: `{question, contexts[], ground_truth}` |
| `EXPECT_CTN` | CLOB | Y | — | 정답 (없으면 `INPUT_CTN.ground_truth` 사용) |
| `CRITERIA_CTN` | CLOB | Y | — | 평가 기준 (자유 텍스트) |
| `TYPE_CD` | VARCHAR2(50) | Y | 'NORMAL' | 케이스 유형 |
| `USER_ID` | VARCHAR2(50) | N | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PTX_RUN_MAS

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `RUN_ID` | NUMBER | N | IDENTITY | PK |
| `PROMPT_ID` | NUMBER | Y | — | FK → `PTX_PROMPT_HIS` |
| `AB_GROUP_ID` | NUMBER | Y | — | A/B 쌍 식별자(= A 쪽 `RUN_ID`), 단일 실행은 NULL |
| `DATASET_ID` | NUMBER | Y | — | FK → `PTX_DATASET_MAS` (데이터셋 삭제 시 NULL) |
| `DATASET_NM` | VARCHAR2(200) | Y | — | 실행 시점 이름 스냅샷 — 데이터셋이 지워져도 기록에 남음 |
| `STATUS_CD` | VARCHAR2(20) | Y | 'PENDING' | PENDING / RUNNING / CANCELLING / DONE / FAILED / CANCELLED |
| `EXACT_VAL` | NUMBER(5,4) | Y | — | 정답 일치 평균 = 일치율 |
| `FAITH_VAL` | NUMBER(5,4) | Y | — | 이하 RAGAS 5종 평균 |
| `ANS_RELEVANCY_VAL` | NUMBER(5,4) | Y | — | |
| `CNTX_PRECISION_VAL` | NUMBER(5,4) | Y | — | |
| `CNTX_RECALL_VAL` | NUMBER(5,4) | Y | — | |
| `ANS_CORRECTNESS_VAL` | NUMBER(5,4) | Y | — | |
| `JUDGE_PROVIDER_CD` | VARCHAR2(50) | Y | — | 호환용 |
| `JUDGE_MODEL_NM` | VARCHAR2(100) | Y | — | 요청별 judge LLM override |
| `METRIC_CTN` | CLOB | Y | — | JSON 배열 — 이번 실행에 채점한 지표 (`[]` = 미채점) |
| `ENGINE_CD` | VARCHAR2(20) | Y | — | RAGAS / FALLBACK / exact(정답 일치만) / direct(수동 호출) |
| `ERROR_CTN` | CLOB | Y | — | |
| `START_TM` | TIMESTAMP | Y | — | |
| `END_TM` | TIMESTAMP | Y | — | |
| `USER_ID` | VARCHAR2(50) | N | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PTX_RUN_DET

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `RESULT_ID` | NUMBER | N | IDENTITY | PK |
| `RUN_ID` | NUMBER | N | — | FK → `PTX_RUN_MAS` |
| `CASE_ID` | NUMBER | Y | — | FK → `PTX_DATASET_DET` |
| `QUESTION_CTN` | CLOB | Y | — | |
| `ANSWER_CTN` | CLOB | Y | — | 외부 API 응답 |
| `CNTX_CTN` | CLOB | Y | — | JSON 배열 |
| `TRUTH_CTN` | CLOB | Y | — | ground truth |
| `TRACE_ID` | VARCHAR2(50) | Y | — | 이 호출에 실어 보낸 상관키 (`PM-YYYYMMDD-NNNN`) |
| `TRACE_VAR_NM` | VARCHAR2(100) | Y | — | 채점한 중간 변수명 (NULL = 최종 답변으로 채점) |
| `TRACE_CTN` | CLOB | Y | — | 그 값의 스냅샷 — `PTX_TRACE_HIS`가 지워져도 남음 |
| `EXACT_VAL` | NUMBER(5,4) | Y | — | 1(O) / 0(X) / NULL(정답 없음). `TRACE_CTN`이 있으면 그 값과 비교한 결과 |
| `FAITH_VAL` | NUMBER(5,4) | Y | — | 이하 케이스별 점수 |
| `ANS_RELEVANCY_VAL` | NUMBER(5,4) | Y | — | |
| `CNTX_PRECISION_VAL` | NUMBER(5,4) | Y | — | |
| `CNTX_RECALL_VAL` | NUMBER(5,4) | Y | — | |
| `ANS_CORRECTNESS_VAL` | NUMBER(5,4) | Y | — | |
| `ERROR_CTN` | CLOB | Y | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PTX_AUDIT_HIS

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `LOG_ID` | NUMBER | N | IDENTITY | PK |
| `TARGET_TABLE_NM` | VARCHAR2(50) | N | — | 예: 'PTX_RUN_MAS' |
| `TARGET_ID` | NUMBER | N | — | 대상 row PK 값 |
| `ACTION_CD` | VARCHAR2(20) | N | — | CREATE / UPDATE / DELETE 등 |
| `BEFORE_CTN` | CLOB | Y | — | 변경 전 JSON 스냅샷 |
| `AFTER_CTN` | CLOB | Y | — | 변경 후 JSON 스냅샷 |
| `USER_ID` | VARCHAR2(50) | N | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PTX_TRACE_HIS

응답에 실을 수 없는 중간 변수를 채점하기 위한 테이블. **에이전트가 INSERT 하고 PTX 는 읽기만 한다.**
상관키 `TRACE_ID` 는 PTX 가 발급해 `session_system_prompt` 에 실어 보낸 값이다.
행이 있으면 그 실행은 최종 답변 대신 이 값을 정답지와 비교한다 — **행의 존재 자체가 신호**라
노드 매핑이나 케이스 설정이 없다.

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `TRACE_SEQ_ID` | NUMBER | N | IDENTITY | PK |
| `TRACE_ID` | VARCHAR2(50) | N | — | PTX 가 발급한 호출 식별자 |
| `VAR_NM` | VARCHAR2(100) | Y | — | 변수명 (예: `parsed`) |
| `VAR_CTN` | CLOB | Y | — | 값 (JSON) |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

> FK 없음 — 에이전트가 먼저 쓰고 PTX 가 나중에 읽으므로 부모 행이 아직 없을 수 있다.
> 실행 기록을 지우면 그 실행의 `TRACE_ID` 행도 함께 지운다. 남는 행(어느 실행에도 안 붙은 호출)은
> 보존기간을 정해 주기적으로 지운다 (실행 기록엔 `PTX_RUN_DET.TRACE_CTN` 스냅샷으로 남는다).
> 에이전트 계정이 PTX 스키마와 다르면 `GRANT INSERT ON PTX_TRACE_HIS TO <agent_user>` 가 필요하다.

## PTX_MODEL_MAS

외부 에이전트 config 의 LLM role(`llm` / `vlm` / `light_llm` / `judge_llm`) 별 모델명.
**PTX 가 쓰고 에이전트가 읽는다** — 적용은 에이전트가 자기 config 를 조립할 때 한다
(`docs/model-roles-agent.md`). DDL 이 현재 role 을 seed 하고, 에이전트 `LLMModel` enum 이
늘거나 줄면 화면에서 행을 추가·삭제한다.

`endpoint` / `api_key` 는 role 4종이 공통으로 써서 에이전트 config 에 남긴다. 키를 여기
두면 `PTX_AUDIT_HIS` 의 before/after 스냅샷에 평문으로 복사된다.

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `MODEL_ID` | NUMBER | N | IDENTITY | PK |
| `ROLE_CD` | VARCHAR2(30) | N | — | UQ. 에이전트 `LLMModel` enum 의 value 와 **글자까지 동일** |
| `MODEL_NM` | VARCHAR2(200) | Y | — | NULL = 에이전트 config 의 기본 모델명 사용 |
| `TEMPERATURE` | NUMBER(3,2) | Y | — | NULL = `LLMModelConfig` 기본값(0.1) |
| `DESC_CTN` | VARCHAR2(500) | Y | — | 메모 |
| `USER_ID` | VARCHAR2(50) | N | — | 마지막으로 저장한 사람 |
| `UPDATE_TM` | TIMESTAMP | Y | — | |
| `CRT_TM` | TIMESTAMP | Y | SYSTIMESTAMP | |

> 에이전트 계정이 PTX 스키마와 다르면 `GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>` 가 필요하다.

---

## 인덱스

```
IDX_PTX_PROMPT_NODE     ON PTX_PROMPT_HIS (NODE_NM, ACTIVE_YN)
IDX_PTX_RUN_DET_RUN     ON PTX_RUN_DET (RUN_ID)
IDX_PTX_RUN_MAS_DS      ON PTX_RUN_MAS (DATASET_ID)
IDX_PTX_AUDIT_TARGET    ON PTX_AUDIT_HIS (TARGET_TABLE_NM, TARGET_ID)
IDX_PTX_TRACE_ID        ON PTX_TRACE_HIS (TRACE_ID)
```

## FK 삭제 규칙

삭제 순서를 앱이 챙기지 않는다. 규칙이 제약에 박혀 있어 대상 테이블만 지우면 된다.

| FK | 규칙 | 결과 |
|---|---|---|
| `RUN_DET.RUN_ID` → `RUN_MAS` | CASCADE | 실행을 지우면 케이스별 결과도 같이 |
| `RUN_DET.CASE_ID` → `DATASET_DET` | SET NULL | 케이스를 지워도 과거 결과는 남음 |
| `DATASET_DET.DATASET_ID` → `DATASET_MAS` | CASCADE | 데이터셋을 지우면 케이스도 같이 |
| `RUN_MAS.DATASET_ID` → `DATASET_MAS` | SET NULL | 데이터셋을 지워도 실행 기록은 남음 (이름은 `DATASET_NM` 스냅샷) |
| `RUN_MAS.PROMPT_ID` → `PROMPT_HIS` | SET NULL | 프롬프트 버전을 지워도 실행 기록은 남음 |
| `PROMPT_HIS.PREV_PROMPT_ID` → 자기 자신 | SET NULL | 이전 버전을 지우면 체인만 끊김 |

## 마이그레이션

- `PM_*` 스키마가 이미 있으면 → `sql/migrate_ptx_rename.sql` (테이블·컬럼 rename + FK 규칙
  재정의 + `DATASET_NM` 백필 + 감사 로그의 옛 테이블명 갱신). 데이터는 보존된다.
- 중간 변수 채점을 붙일 때 → `sql/migrate_trace_var.sql` (`PTX_TRACE_HIS` 생성 +
  `PTX_RUN_DET.TRACE_*` 3컬럼 추가). 에이전트 쪽 연동은 `docs/trace-var-agent.md`.
- LLM role 별 모델 관리를 붙일 때 → `sql/migrate_model_mas.sql` (`PTX_MODEL_MAS` 생성 +
  role 4종 seed). 에이전트 쪽 연동은 `docs/model-roles-agent.md`.
