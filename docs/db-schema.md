# PM DB 스키마 (Oracle 19c+)

PM 소유 테이블 6개. 외부 테이블(`CHAT_VER_MAS` / `NODE_MAS` / `MODEL_MAS`)에 대한 FK 없음.
노드 식별자는 `NODE_NM` 문자열이고 별도 노드 마스터 테이블은 없다.

실행용 DDL은 **`sql/ddl_initial.sql`**(권위 스키마)에 있다. 이 문서는 컬럼 명세만 담는다.

| 테이블                | 역할                          | PK                | FK                                       |
|----------------------|-------------------------------|-------------------|------------------------------------------|
| `PM_NODE_PROMPT_VER` | 노드별 프롬프트 버전          | `PROMPT_ID`       | `PREV_PROMPT_ID` → 자기 자신             |
| `PM_TEST_DATASET`    | 평가 데이터셋                 | `DATASET_ID`      | —                                        |
| `PM_TEST_CASE`       | 데이터셋 케이스               | `CASE_ID`         | `DATASET_ID` → `PM_TEST_DATASET`         |
| `PM_RAGAS_RUN`       | 평가 실행 1건 (단일/AB)       | `RAGAS_RUN_ID`    | `PROMPT_ID` → `PM_NODE_PROMPT_VER`, `DATASET_ID` → `PM_TEST_DATASET` |
| `PM_RAGAS_RESULT`    | 케이스별 결과                 | `RAGAS_RESULT_ID` | `RAGAS_RUN_ID` → `PM_RAGAS_RUN`, `CASE_ID` → `PM_TEST_CASE` |
| `PM_AUDIT_LOG`       | 변경 감사 로그                | `LOG_ID`          | 없음 (`TARGET_TABLE`+`TARGET_ID`만 기록) |

---

## PM_NODE_PROMPT_VER

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `PROMPT_ID` | NUMBER | N | IDENTITY | PK |
| `NODE_NM` | VARCHAR2(200) | N | — | 노드 식별자 |
| `VERSION_NO` | VARCHAR2(20) | N | — | UQ(`NODE_NM`, `VERSION_NO`) |
| `SYSTEM_PROMPT` | CLOB | Y | — | |
| `USER_PROMPT` | CLOB | Y | — | |
| `MODEL_NM` | VARCHAR2(100) | Y | — | |
| `IS_ACTIVE` | VARCHAR2(1) | Y | 'N' | 테스트 실행 중에만 일시적으로 'Y' (상시 활성 버전 개념 없음) |
| `CHANGE_SUMMARY` | VARCHAR2(500) | Y | — | |
| `CHANGE_REASON` | VARCHAR2(1000) | Y | — | |
| `PREV_PROMPT_ID` | NUMBER | Y | — | FK → `PM_NODE_PROMPT_VER(PROMPT_ID)` |
| `CREATED_BY` | VARCHAR2(50) | N | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |
| `UPDATED_DT` | TIMESTAMP | Y | — | |

## PM_TEST_DATASET

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `DATASET_ID` | NUMBER | N | IDENTITY | PK |
| `DATASET_NM` | VARCHAR2(200) | N | — | |
| `DESCRIPTION` | VARCHAR2(500) | Y | — | |
| `IS_ACTIVE` | VARCHAR2(1) | Y | 'Y' | 'N' = 내부용(수동 호출 기록용 sink)이라 목록에서 숨김 |
| `CREATED_BY` | VARCHAR2(50) | N | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PM_TEST_CASE

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `CASE_ID` | NUMBER | N | IDENTITY | PK |
| `DATASET_ID` | NUMBER | N | — | FK → `PM_TEST_DATASET` |
| `INPUT_DATA` | CLOB | N | — | JSON: `{question, contexts[], ground_truth}` |
| `EXPECTED_OUTPUT` | CLOB | Y | — | 정답 (없으면 `INPUT_DATA.ground_truth` 사용) |
| `EVAL_CRITERIA` | CLOB | Y | — | |
| `CASE_TYPE` | VARCHAR2(50) | Y | 'NORMAL' | |
| `CREATED_BY` | VARCHAR2(50) | N | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PM_RAGAS_RUN

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `RAGAS_RUN_ID` | NUMBER | N | IDENTITY | PK |
| `PROMPT_ID` | NUMBER | Y | — | FK → `PM_NODE_PROMPT_VER` |
| `AB_GROUP_ID` | NUMBER | Y | — | A/B 쌍 식별자(= A 쪽 `RAGAS_RUN_ID`), 단일 실행은 NULL |
| `DATASET_ID` | NUMBER | N | — | FK → `PM_TEST_DATASET` |
| `STATUS` | VARCHAR2(20) | Y | 'PENDING' | PENDING / RUNNING / CANCELLING / DONE / FAILED / CANCELLED |
| `EXACT_MATCH` | NUMBER(5,4) | Y | — | 정답 일치 평균 = 일치율 |
| `FAITHFULNESS` | NUMBER(5,4) | Y | — | 이하 RAGAS 5종 평균 |
| `ANSWER_RELEVANCY` | NUMBER(5,4) | Y | — | |
| `CONTEXT_PRECISION` | NUMBER(5,4) | Y | — | |
| `CONTEXT_RECALL` | NUMBER(5,4) | Y | — | |
| `ANSWER_CORRECTNESS` | NUMBER(5,4) | Y | — | |
| `JUDGE_PROVIDER` | VARCHAR2(50) | Y | — | 호환용 |
| `JUDGE_MODEL` | VARCHAR2(100) | Y | — | 요청별 judge LLM override |
| `METRICS` | CLOB | Y | — | JSON 배열 — 이번 실행에 채점한 지표 (`[]` = 미채점) |
| `ENGINE` | VARCHAR2(20) | Y | — | RAGAS / FALLBACK / exact(정답 일치만) / direct(수동 호출) |
| `ERROR_MSG` | CLOB | Y | — | |
| `STARTED_DT` | TIMESTAMP | Y | — | |
| `ENDED_DT` | TIMESTAMP | Y | — | |
| `CREATED_BY` | VARCHAR2(50) | N | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PM_RAGAS_RESULT

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `RAGAS_RESULT_ID` | NUMBER | N | IDENTITY | PK |
| `RAGAS_RUN_ID` | NUMBER | N | — | FK → `PM_RAGAS_RUN` |
| `CASE_ID` | NUMBER | Y | — | FK → `PM_TEST_CASE` |
| `QUESTION` | CLOB | Y | — | |
| `ANSWER` | CLOB | Y | — | 외부 API 응답 |
| `CONTEXTS` | CLOB | Y | — | JSON 배열 |
| `GROUND_TRUTH` | CLOB | Y | — | |
| `EXACT_MATCH` | NUMBER(5,4) | Y | — | 1(O) / 0(X) / NULL(정답 없음) |
| `FAITHFULNESS` | NUMBER(5,4) | Y | — | 이하 케이스별 점수 |
| `ANSWER_RELEVANCY` | NUMBER(5,4) | Y | — | |
| `CONTEXT_PRECISION` | NUMBER(5,4) | Y | — | |
| `CONTEXT_RECALL` | NUMBER(5,4) | Y | — | |
| `ANSWER_CORRECTNESS` | NUMBER(5,4) | Y | — | |
| `ERROR_MSG` | CLOB | Y | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |

## PM_AUDIT_LOG

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| `LOG_ID` | NUMBER | N | IDENTITY | PK |
| `TARGET_TABLE` | VARCHAR2(50) | N | — | 예: 'PM_RAGAS_RUN' |
| `TARGET_ID` | NUMBER | N | — | 대상 row PK 값 |
| `ACTION` | VARCHAR2(20) | N | — | CREATE / UPDATE / DELETE 등 |
| `BEFORE_VALUE` | CLOB | Y | — | JSON 스냅샷 |
| `AFTER_VALUE` | CLOB | Y | — | JSON 스냅샷 |
| `CREATED_BY` | VARCHAR2(50) | N | — | |
| `CREATED_DT` | TIMESTAMP | Y | SYSTIMESTAMP | |

---

## 인덱스

```
IDX_PM_PROMPT_NODENM_ACT  ON PM_NODE_PROMPT_VER (NODE_NM, IS_ACTIVE)
IDX_PM_RAGASRESULT_RUN    ON PM_RAGAS_RESULT (RAGAS_RUN_ID)
IDX_PM_RAGASRUN_DATASET   ON PM_RAGAS_RUN (DATASET_ID)
IDX_PM_AUDIT_TARGET       ON PM_AUDIT_LOG (TARGET_TABLE, TARGET_ID)
```

## 삭제 순서 (FK)

`PM_RAGAS_RESULT` → `PM_RAGAS_RUN` → `PM_TEST_CASE` → `PM_TEST_DATASET`.
케이스만 지울 때는 참조하는 `PM_RAGAS_RESULT.CASE_ID` 를 먼저 NULL 로 만든다.
