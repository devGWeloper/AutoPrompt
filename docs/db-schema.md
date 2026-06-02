# PM DB 스키마 (Oracle, 사내 직접 생성용)

> 본 문서는 Prompt-Management 백엔드가 사용하는 **PM_* 테이블 전체 명세**이다.
> 외부 시스템 owned 테이블(CHAT_VER_MAS / NODE_MAS / MODEL_MAS)에 대한 의존성은
> 모두 제거되어 있다. PM 은 자신의 6개 테이블만 가진다.
>
> 노드 식별자는 **NODE_NM** 문자열. 외부 ID FK 없음. 첫 프롬프트 버전을 만들면
> 자동으로 새 노드가 등록된다 (별도 노드 마스터 테이블 없음).

---

## 1. 테이블 한눈 요약

| 테이블                  | 역할                                         | PK             | 주요 unique / FK                          |
|------------------------|---------------------------------------------|----------------|--------------------------------------------|
| `PM_NODE_PROMPT_VER`   | 노드별 프롬프트 버전 (system/user + 모델)    | `PROMPT_ID`    | UQ (`NODE_NM`, `VERSION_NO`); 자기참조 FK |
| `PM_TEST_DATASET`      | RAGAS 평가용 데이터셋 (flow 단위)           | `DATASET_ID`   | —                                          |
| `PM_TEST_CASE`         | 데이터셋 내 케이스(입력/정답/문맥)           | `CASE_ID`      | FK → `PM_TEST_DATASET`                     |
| `PM_RAGAS_RUN`         | RAGAS 평가 한 건 (단일/AB)                   | `RAGAS_RUN_ID` | FK → `PM_NODE_PROMPT_VER`, `PM_TEST_DATASET` |
| `PM_RAGAS_RESULT`      | RAGAS 평가의 케이스별 결과                   | `RAGAS_RESULT_ID` | FK → `PM_RAGAS_RUN`, `PM_TEST_CASE`    |
| `PM_AUDIT_LOG`         | PM_* 테이블의 변경 감사 로그                 | `LOG_ID`       | —                                          |
| `PM_SYSTEM_CONFIG`     | 시스템 단일 토글 (Y/N) — single-row          | `ENABLED_YN`   | —                                          |

총 7개. 다른 PM_* 테이블 없음.

---

## 2. ERD (텍스트)

```
                       ┌────────────────────────┐
                       │   PM_NODE_PROMPT_VER   │
                       │  (NODE_NM, VERSION_NO) │
                       │  IS_ACTIVE, MODEL_NM   │
                       │  SYSTEM_PROMPT,        │
                       │  USER_PROMPT           │
                       └───┬────────────────┬───┘
       PREV_PROMPT_ID ◀────┘ (self FK)      │ PROMPT_ID
                                            ▼
                       ┌────────────────────────┐
                       │      PM_RAGAS_RUN      │◀──────────┐
                       │  status, metrics,      │           │
                       │  judge_*, engine,      │           │
                       │  scores 5종            │           │
                       │  ab_group_id           │           │
                       └───┬────────────────────┘           │
                           │ RAGAS_RUN_ID                   │ DATASET_ID
                           ▼                                │
                       ┌────────────────────────┐           │
                       │     PM_RAGAS_RESULT    │           │
                       │  case-level scores +   │           │
                       │  Q/A/contexts/GT       │           │
                       └───┬────────────────────┘           │
                           │ CASE_ID                        │
                           ▼                                │
                       ┌────────────────────────┐           │
                       │     PM_TEST_CASE       │           │
                       └───┬────────────────────┘           │
                           │ DATASET_ID                     │
                           ▼                                │
                       ┌────────────────────────┐           │
                       │    PM_TEST_DATASET     │───────────┘
                       └────────────────────────┘

   PM_AUDIT_LOG       (PM_* 모든 변경 감사 로그 — FK 없음, target_table+target_id 만 기록)
   PM_SYSTEM_CONFIG   (시스템 단일 토글 — ENABLED_YN 한 컬럼, single-row)
```

---

## 3. 테이블별 상세

### 3.1 `PM_NODE_PROMPT_VER` — 노드 프롬프트 버전

노드 단위 프롬프트의 버전 이력. 한 노드(NODE_NM)당 여러 버전, 그 중 한 줄만
`IS_ACTIVE='Y'`. **외부 모델은 이 active row 를 그대로 읽어** SYSTEM_PROMPT /
USER_PROMPT / MODEL_NM 을 가져간다.

| 컬럼              | 타입               | NULL | 기본값                  | 비고                                  |
|------------------|--------------------|------|------------------------|---------------------------------------|
| `PROMPT_ID`      | NUMBER             | N    | IDENTITY (always)       | PK                                    |
| `NODE_NM`        | VARCHAR2(200)      | N    | —                       | 노드 식별자(문자열)                   |
| `VERSION_NO`     | VARCHAR2(20)       | N    | —                       | "major.minor.patch" 권장              |
| `SYSTEM_PROMPT`  | CLOB               | Y    | —                       | system 프롬프트 원문                  |
| `USER_PROMPT`    | CLOB               | Y    | —                       | user 프롬프트(템플릿)                 |
| `MODEL_NM`       | VARCHAR2(100)      | Y    | —                       | 이 버전이 쓸 모델 이름                |
| `IS_ACTIVE`      | VARCHAR2(1)        | N    | 'N'                     | 'Y'/'N' — 노드당 한 줄만 'Y'          |
| `CHANGE_SUMMARY` | VARCHAR2(500)      | Y    | —                       | 변경 요약                             |
| `CHANGE_REASON`  | VARCHAR2(1000)     | Y    | —                       | 변경 사유                             |
| `PREV_PROMPT_ID` | NUMBER             | Y    | —                       | FK → 같은 테이블 `PROMPT_ID`         |
| `CREATED_BY`     | VARCHAR2(50)       | N    | —                       |                                       |
| `CREATED_DT`     | TIMESTAMP          | Y    | SYSTIMESTAMP            |                                       |
| `UPDATED_DT`     | TIMESTAMP          | Y    | —                       | 활성화/편집 시 갱신                   |

- **Unique**: `(NODE_NM, VERSION_NO)` — 같은 노드 같은 버전 중복 금지.
- **FK (자기참조)**: `PREV_PROMPT_ID → PM_NODE_PROMPT_VER(PROMPT_ID)` — 직전 버전 기록.
- **운영 규칙**:
  - 활성 버전 (`IS_ACTIVE='Y'`)은 직접 편집 불가 (서비스가 400 으로 막음).
    수정하려면 새 버전을 만든다.
  - 활성 전환은 PM API (`PUT /api/v1/prompts/{prompt_id}/activate`)로만.
    트랜잭션 내에서 같은 NODE_NM 의 다른 row 들의 `IS_ACTIVE` 를 'N' 으로 내리고,
    대상 row 를 'Y' 로 올린다.
  - A/B RAGAS 평가 중에는 `_swap_active_prompt` / `_restore_active_prompt` 로
    `IS_ACTIVE` 가 일시적으로 토글된다 — 외부 모델 측에서 짧은 TTL 또는 매 호출
    재조회가 필요. 평가 종료 finally 에서 원본 active row 가 복구된다.

---

### 3.2 `PM_TEST_DATASET` — RAGAS 데이터셋

평가용 케이스 묶음. flow 단위 (단일 flow 가정이므로 별도 anchor 불필요).

| 컬럼          | 타입               | NULL | 기본값        | 비고                          |
|--------------|--------------------|------|---------------|-------------------------------|
| `DATASET_ID` | NUMBER             | N    | IDENTITY      | PK                            |
| `DATASET_NM` | VARCHAR2(200)      | N    | —             | 사용자에게 보이는 이름        |
| `DESCRIPTION`| VARCHAR2(500)      | Y    | —             | 설명                          |
| `IS_ACTIVE`  | VARCHAR2(1)        | N    | 'Y'           | 'Y'/'N' (soft toggle)         |
| `CREATED_BY` | VARCHAR2(50)       | N    | —             |                               |
| `CREATED_DT` | TIMESTAMP          | Y    | SYSTIMESTAMP  |                               |

자식: `PM_TEST_CASE.DATASET_ID`.

---

### 3.3 `PM_TEST_CASE` — 데이터셋 케이스

한 데이터셋 내 한 케이스. `INPUT_DATA` 는 보통 JSON 문자열로
`{question, contexts[], ground_truth}` 를 담는다(서비스가 키 이름에 관대하게
해석).

| 컬럼              | 타입            | NULL | 기본값        | 비고                                    |
|------------------|------------------|------|---------------|-----------------------------------------|
| `CASE_ID`        | NUMBER           | N    | IDENTITY      | PK                                      |
| `DATASET_ID`     | NUMBER           | N    | —             | FK → `PM_TEST_DATASET(DATASET_ID)`      |
| `INPUT_DATA`     | CLOB             | N    | —             | JSON 권장 (question/contexts/ground_truth) |
| `EXPECTED_OUTPUT`| CLOB             | Y    | —             | 정답 (없으면 input_data 안의 ground_truth 사용) |
| `EVAL_CRITERIA`  | CLOB             | Y    | —             | 자유 텍스트                             |
| `CASE_TYPE`      | VARCHAR2(50)     | N    | 'NORMAL'      |                                         |
| `CREATED_BY`     | VARCHAR2(50)     | N    | —             |                                         |
| `CREATED_DT`     | TIMESTAMP        | Y    | SYSTIMESTAMP  |                                         |

---

### 3.4 `PM_RAGAS_RUN` — RAGAS 평가 한 건

플로우 단위 RAGAS 평가. 단일 실행이거나, 두 프롬프트 버전을 비교하는 A/B 쌍의
한 쪽이다. A/B 인 경우 `PROMPT_ID` + `AB_GROUP_ID` 가 채워진다 (단일은 둘 다 NULL).

| 컬럼                 | 타입            | NULL | 기본값        | 비고                                                   |
|---------------------|------------------|------|---------------|--------------------------------------------------------|
| `RAGAS_RUN_ID`      | NUMBER           | N    | IDENTITY      | PK                                                     |
| `PROMPT_ID`         | NUMBER           | Y    | —             | A/B 시 평가 대상 버전. FK → `PM_NODE_PROMPT_VER`       |
| `AB_GROUP_ID`       | NUMBER           | Y    | —             | A/B 쌍 식별자 (= A 쪽 `RAGAS_RUN_ID`). 단일은 NULL.   |
| `DATASET_ID`        | NUMBER           | N    | —             | FK → `PM_TEST_DATASET(DATASET_ID)`                    |
| `STATUS`            | VARCHAR2(20)     | N    | 'PENDING'     | PENDING / RUNNING / DONE / FAILED                      |
| `FAITHFULNESS`      | NUMBER(5,4)      | Y    | —             | 평균 점수 (5종)                                        |
| `ANSWER_RELEVANCY`  | NUMBER(5,4)      | Y    | —             |                                                        |
| `CONTEXT_PRECISION` | NUMBER(5,4)      | Y    | —             |                                                        |
| `CONTEXT_RECALL`    | NUMBER(5,4)      | Y    | —             |                                                        |
| `ANSWER_CORRECTNESS`| NUMBER(5,4)      | Y    | —             |                                                        |
| `JUDGE_PROVIDER`    | VARCHAR2(50)     | Y    | —             | 요청 시 지정 가능 (실제 사용 안 함, 호환용)             |
| `JUDGE_MODEL`       | VARCHAR2(100)    | Y    | —             | 요청별 judge LLM 모델 override                          |
| `METRICS`           | CLOB             | Y    | —             | JSON 배열 — 이번 run 에 채점한 metric 목록             |
| `ENGINE`            | VARCHAR2(20)     | Y    | —             | 'RAGAS' / 'FALLBACK' (실행 시 결정)                   |
| `ERROR_MSG`         | CLOB             | Y    | —             | FAILED 사유                                            |
| `STARTED_DT`        | TIMESTAMP        | Y    | —             |                                                        |
| `ENDED_DT`          | TIMESTAMP        | Y    | —             |                                                        |
| `CREATED_BY`        | VARCHAR2(50)     | N    | —             |                                                        |
| `CREATED_DT`        | TIMESTAMP        | Y    | SYSTIMESTAMP  |                                                        |

자식: `PM_RAGAS_RESULT.RAGAS_RUN_ID`.

> 단일 flow 가정으로 `CHAT_VER_ID` / 외부 노드 ID 컬럼은 없다.

---

### 3.5 `PM_RAGAS_RESULT` — RAGAS 케이스별 결과

`PM_RAGAS_RUN` 한 건의 케이스별 출력 + 점수.

| 컬럼                 | 타입            | NULL | 기본값        | 비고                                          |
|---------------------|------------------|------|---------------|-----------------------------------------------|
| `RAGAS_RESULT_ID`   | NUMBER           | N    | IDENTITY      | PK                                            |
| `RAGAS_RUN_ID`      | NUMBER           | N    | —             | FK → `PM_RAGAS_RUN(RAGAS_RUN_ID)`            |
| `CASE_ID`           | NUMBER           | Y    | —             | FK → `PM_TEST_CASE(CASE_ID)`                 |
| `QUESTION`          | CLOB             | Y    | —             | 평가에 들어간 질문                            |
| `ANSWER`            | CLOB             | Y    | —             | 외부 모델 응답(`response`)                    |
| `CONTEXTS`          | CLOB             | Y    | —             | JSON 배열 (케이스 contexts 또는 응답 docs[])  |
| `GROUND_TRUTH`      | CLOB             | Y    | —             |                                               |
| `FAITHFULNESS`      | NUMBER(5,4)      | Y    | —             | 케이스 점수                                   |
| `ANSWER_RELEVANCY`  | NUMBER(5,4)      | Y    | —             |                                               |
| `CONTEXT_PRECISION` | NUMBER(5,4)      | Y    | —             |                                               |
| `CONTEXT_RECALL`    | NUMBER(5,4)      | Y    | —             |                                               |
| `ANSWER_CORRECTNESS`| NUMBER(5,4)      | Y    | —             |                                               |
| `ERROR_MSG`         | CLOB             | Y    | —             | 이 케이스에서만 실패한 경우 사유               |
| `CREATED_DT`        | TIMESTAMP        | Y    | SYSTIMESTAMP  |                                               |

---

### 3.6 `PM_AUDIT_LOG` — 변경 감사 로그

PM_* 테이블의 모든 의미 있는 변경(생성/수정/활성화/삭제)을 한 줄로 기록.
타겟 테이블에 FK 를 걸지 않고 `(TARGET_TABLE, TARGET_ID)` 만 남긴다 → 대상 row
가 지워져도 감사 로그는 유지.

| 컬럼            | 타입            | NULL | 기본값        | 비고                                          |
|----------------|------------------|------|---------------|-----------------------------------------------|
| `LOG_ID`       | NUMBER           | N    | IDENTITY      | PK                                            |
| `TARGET_TABLE` | VARCHAR2(50)     | N    | —             | 예: 'PM_NODE_PROMPT_VER', 'PM_TEST_DATASET'   |
| `TARGET_ID`    | NUMBER           | N    | —             | 대상 row 의 PK 값                             |
| `ACTION`       | VARCHAR2(20)     | N    | —             | CREATE / UPDATE / ACTIVATE / DELETE 등        |
| `BEFORE_VALUE` | CLOB             | Y    | —             | 변경 전 스냅샷 (JSON 권장)                    |
| `AFTER_VALUE`  | CLOB             | Y    | —             | 변경 후 스냅샷 (JSON 권장)                    |
| `CREATED_BY`   | VARCHAR2(50)     | N    | —             | 행위자                                        |
| `CREATED_DT`   | TIMESTAMP        | Y    | SYSTIMESTAMP  |                                               |

**권장 인덱스**:
- `IDX_PM_AUDIT_TARGET (TARGET_TABLE, TARGET_ID)`
- `IDX_PM_AUDIT_DT (CREATED_DT)`

(이 두 인덱스는 0001 마이그레이션에서 생성되어 현재 살아 있다.)

---

### 3.7 `PM_SYSTEM_CONFIG` — 시스템 단일 토글

시스템 전역 Y/N 한 개. **한 row 만 존재**한다는 운영 규칙 (제약은 걸지 않음 —
컬럼 1개만 유지).

| 컬럼          | 타입            | NULL | 기본값 | 비고                            |
|--------------|------------------|------|--------|---------------------------------|
| `ENABLED_YN` | VARCHAR2(1)      | N    | 'N'    | 'Y' = 켜짐 / 'N' = 꺼짐. PK.    |

- **읽기**: `SELECT ENABLED_YN FROM PM_SYSTEM_CONFIG;` — 항상 한 줄.
- **쓰기**: `UPDATE PM_SYSTEM_CONFIG SET ENABLED_YN = :v;` — 토글.
- **외부 모델 무관**: 외부 모델은 이 테이블을 절대 읽지 않는다. PM UI 토글
  전용.

---

## 4. 통합 Oracle DDL (복사 후 그대로 실행)

부모 → 자식 의존 순서. `PM_AUDIT_LOG` 와 `PM_TEST_DATASET` 은 독립.

```sql
-- ==========================================================================
-- PM_NODE_PROMPT_VER : 노드 프롬프트 버전
-- ==========================================================================
CREATE TABLE PM_NODE_PROMPT_VER (
    PROMPT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_NM         VARCHAR2(200) NOT NULL,
    VERSION_NO      VARCHAR2(20)  NOT NULL,
    SYSTEM_PROMPT   CLOB,
    USER_PROMPT     CLOB,
    MODEL_NM        VARCHAR2(100),
    IS_ACTIVE       VARCHAR2(1)   DEFAULT 'N' NOT NULL,
    CHANGE_SUMMARY  VARCHAR2(500),
    CHANGE_REASON   VARCHAR2(1000),
    PREV_PROMPT_ID  NUMBER,
    CREATED_BY      VARCHAR2(50)  NOT NULL,
    CREATED_DT      TIMESTAMP     DEFAULT SYSTIMESTAMP,
    UPDATED_DT      TIMESTAMP,
    CONSTRAINT UQ_PM_NODE_PROMPT_VER UNIQUE (NODE_NM, VERSION_NO),
    CONSTRAINT FK_PM_NODE_PROMPT_PREV
        FOREIGN KEY (PREV_PROMPT_ID) REFERENCES PM_NODE_PROMPT_VER (PROMPT_ID)
);

-- ==========================================================================
-- PM_TEST_DATASET : RAGAS 데이터셋
-- ==========================================================================
CREATE TABLE PM_TEST_DATASET (
    DATASET_ID   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_NM   VARCHAR2(200) NOT NULL,
    DESCRIPTION  VARCHAR2(500),
    IS_ACTIVE    VARCHAR2(1)   DEFAULT 'Y' NOT NULL,
    CREATED_BY   VARCHAR2(50)  NOT NULL,
    CREATED_DT   TIMESTAMP     DEFAULT SYSTIMESTAMP
);

-- ==========================================================================
-- PM_TEST_CASE : 데이터셋 케이스
-- ==========================================================================
CREATE TABLE PM_TEST_CASE (
    CASE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_ID      NUMBER NOT NULL,
    INPUT_DATA      CLOB   NOT NULL,
    EXPECTED_OUTPUT CLOB,
    EVAL_CRITERIA   CLOB,
    CASE_TYPE       VARCHAR2(50)  DEFAULT 'NORMAL' NOT NULL,
    CREATED_BY      VARCHAR2(50)  NOT NULL,
    CREATED_DT      TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PM_TEST_CASE_DS
        FOREIGN KEY (DATASET_ID) REFERENCES PM_TEST_DATASET (DATASET_ID)
);

-- ==========================================================================
-- PM_RAGAS_RUN : RAGAS 평가 한 건
-- ==========================================================================
CREATE TABLE PM_RAGAS_RUN (
    RAGAS_RUN_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROMPT_ID          NUMBER,
    AB_GROUP_ID        NUMBER,
    DATASET_ID         NUMBER NOT NULL,
    STATUS             VARCHAR2(20)  DEFAULT 'PENDING' NOT NULL,
    FAITHFULNESS       NUMBER(5,4),
    ANSWER_RELEVANCY   NUMBER(5,4),
    CONTEXT_PRECISION  NUMBER(5,4),
    CONTEXT_RECALL     NUMBER(5,4),
    ANSWER_CORRECTNESS NUMBER(5,4),
    JUDGE_PROVIDER     VARCHAR2(50),
    JUDGE_MODEL        VARCHAR2(100),
    METRICS            CLOB,
    ENGINE             VARCHAR2(20),
    ERROR_MSG          CLOB,
    STARTED_DT         TIMESTAMP,
    ENDED_DT           TIMESTAMP,
    CREATED_BY         VARCHAR2(50)  NOT NULL,
    CREATED_DT         TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PM_RAGAS_RUN_PROMPT
        FOREIGN KEY (PROMPT_ID) REFERENCES PM_NODE_PROMPT_VER (PROMPT_ID),
    CONSTRAINT FK_PM_RAGAS_RUN_DS
        FOREIGN KEY (DATASET_ID) REFERENCES PM_TEST_DATASET (DATASET_ID)
);

-- ==========================================================================
-- PM_RAGAS_RESULT : 케이스별 결과
-- ==========================================================================
CREATE TABLE PM_RAGAS_RESULT (
    RAGAS_RESULT_ID    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RAGAS_RUN_ID       NUMBER NOT NULL,
    CASE_ID            NUMBER,
    QUESTION           CLOB,
    ANSWER             CLOB,
    CONTEXTS           CLOB,
    GROUND_TRUTH       CLOB,
    FAITHFULNESS       NUMBER(5,4),
    ANSWER_RELEVANCY   NUMBER(5,4),
    CONTEXT_PRECISION  NUMBER(5,4),
    CONTEXT_RECALL     NUMBER(5,4),
    ANSWER_CORRECTNESS NUMBER(5,4),
    ERROR_MSG          CLOB,
    CREATED_DT         TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PM_RAGAS_RESULT_RUN
        FOREIGN KEY (RAGAS_RUN_ID) REFERENCES PM_RAGAS_RUN (RAGAS_RUN_ID),
    CONSTRAINT FK_PM_RAGAS_RESULT_CASE
        FOREIGN KEY (CASE_ID) REFERENCES PM_TEST_CASE (CASE_ID)
);

-- ==========================================================================
-- PM_AUDIT_LOG : 감사 로그 (FK 없음)
-- ==========================================================================
CREATE TABLE PM_AUDIT_LOG (
    LOG_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TARGET_TABLE   VARCHAR2(50)  NOT NULL,
    TARGET_ID      NUMBER        NOT NULL,
    ACTION         VARCHAR2(20)  NOT NULL,
    BEFORE_VALUE   CLOB,
    AFTER_VALUE    CLOB,
    CREATED_BY     VARCHAR2(50)  NOT NULL,
    CREATED_DT     TIMESTAMP     DEFAULT SYSTIMESTAMP
);

CREATE INDEX IDX_PM_AUDIT_TARGET ON PM_AUDIT_LOG (TARGET_TABLE, TARGET_ID);
CREATE INDEX IDX_PM_AUDIT_DT     ON PM_AUDIT_LOG (CREATED_DT);

-- ==========================================================================
-- PM_SYSTEM_CONFIG : 시스템 단일 토글 (한 row)
-- ==========================================================================
CREATE TABLE PM_SYSTEM_CONFIG (
    ENABLED_YN VARCHAR2(1) DEFAULT 'N' NOT NULL
);
INSERT INTO PM_SYSTEM_CONFIG (ENABLED_YN) VALUES ('N');
COMMIT;
```

---

## 5. 초기 시드 (선택, 데모용)

홈 화면 노드 카드가 한 줄이라도 뜨게 하려면 노드를 하나 등록한다.
백엔드 스크립트로도 동일: `backend/scripts/seed_pm_demo.py`.

```sql
INSERT INTO PM_NODE_PROMPT_VER
  (NODE_NM, VERSION_NO, SYSTEM_PROMPT, USER_PROMPT, MODEL_NM,
   IS_ACTIVE, CHANGE_SUMMARY, CHANGE_REASON, CREATED_BY)
VALUES
  ('llm', '1.0.0',
   'You are helpful.', 'Question: {{q}}',
   'claude-sonnet-4-6',
   'Y', 'seed', 'initial demo', 'system');
COMMIT;
```

새 노드를 추가하고 싶을 때도 동일: 새 NODE_NM 으로 첫 row 를 만들면 끝.
(별도 노드 마스터 테이블 없음 — PM_NODE_PROMPT_VER 의 distinct NODE_NM 이 곧
노드 목록이다.)

---

## 6. 운영 메모

- **활성화 동시성**: 같은 NODE_NM 의 활성 row 는 항상 0 또는 1 건. 두 건 이상
  'Y' 가 보이면 비정상. 활성화는 PM API 한 곳에서만 일어나야 한다 — 손으로
  UPDATE 금지 권장.
- **A/B 평가 토글**: A/B RAGAS 가 실행 중일 때 `IS_ACTIVE` 가 일시 변경됐다가
  finally 에서 복구된다. 평가 진행 중 외부 모델이 active row 를 어떻게 캐싱
  하는지에 따라 결과가 달라지니, 외부 모델 측은 짧은 TTL(예: 5초) 또는 매
  호출 재조회를 사용한다.
- **CLOB 컬럼**: 프롬프트/입력/응답 등은 CLOB. 평소 운영에 영향 없지만,
  대량 조회·CSV export 시 CLOB → VARCHAR2 변환 비용이 든다.
- **PM_RAGAS_RUN.METRICS**: 평가 시 채점한 metric 명 JSON 배열. CSV export
  헤더 결정 등에 사용.

---

## 7. 외부 시스템과의 관계 (요약)

PM 은 외부 owned 테이블(`CHAT_VER_MAS` / `NODE_MAS` / `MODEL_MAS`)에 **아무런
의존도 없다**. 외부 모델과의 접점은 두 곳뿐이다:

1. **외부 모델 → `PM_NODE_PROMPT_VER` 직접 READ**:
   ```sql
   SELECT SYSTEM_PROMPT, USER_PROMPT, MODEL_NM
     FROM PM_NODE_PROMPT_VER
    WHERE NODE_NM = :node_nm AND IS_ACTIVE = 'Y';
   ```
2. **PM → 외부 모델 HTTP `/chat`** (RAGAS 평가 시 답변 생성용):
   - 요청: `{ "message": "...", "user_id": "pm-test" }`
   - 응답: `{ "response": "...", "docs": [...], ... }`

자세한 외부 모델 contract 는 `.claude/skills/connect-prompt-mgmt/` 참고.
