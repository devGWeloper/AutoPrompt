# PTX DB 스키마 (Oracle 19c+)

Prompt Trace eXplorer(PTX) 소유 테이블 6개. 외부 테이블(`CHAT_VER_MAS` / `NODE_MAS` / `MODEL_MAS`)에 대한 FK 없음.
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
| `EXACT_VAL` | NUMBER(5,4) | Y | — | 1(O) / 0(X) / NULL(정답 없음) |
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

---

## 인덱스

```
IDX_PTX_PROMPT_NODE     ON PTX_PROMPT_HIS (NODE_NM, ACTIVE_YN)
IDX_PTX_RUN_DET_RUN     ON PTX_RUN_DET (RUN_ID)
IDX_PTX_RUN_MAS_DS      ON PTX_RUN_MAS (DATASET_ID)
IDX_PTX_AUDIT_TARGET    ON PTX_AUDIT_HIS (TARGET_TABLE_NM, TARGET_ID)
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

## 기존 DB 이름 변경

`PM_*` 스키마가 이미 있으면 `sql/migrate_ptx_rename.sql` 을 실행한다 (테이블·컬럼 rename +
FK 규칙 재정의 + `DATASET_NM` 백필 + 감사 로그의 옛 테이블명 갱신). 데이터는 보존된다.
