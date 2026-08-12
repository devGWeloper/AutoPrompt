-- ============================================================
-- Prompt Trace eXplorer (PTX) — PTX-owned schema DDL  (Oracle 19c+ / XE 21c)
--
-- Authoritative source = the app's DB layer (src/lib/db/rows.ts + services).
-- PTX is fully self-contained: node identity is NODE_NM and there are NO FKs to
-- external operational tables (CHAT_VER_MAS / NODE_MAS / MODEL_MAS).
--
-- 명명 규칙
--   테이블  PTX_<대상>_MAS(마스터) / _DET(상세) / _HIS(이력)
--   컬럼    _ID 식별자  _NM 명  _NO 번호  _CD 코드  _CTN 내용  _YN 여부
--           _TM 일시    _VAL 값
--
-- 삭제 규칙은 FK 에 박혀 있다(앱이 순서를 챙기지 않는다):
--   실행 삭제     → 케이스별 결과 CASCADE
--   케이스 삭제   → 과거 결과는 CASE_ID 만 NULL (기록 보존)
--   데이터셋 삭제 → 케이스 CASCADE, 과거 실행은 DATASET_ID 만 NULL (기록 보존,
--                   이름은 PTX_RUN_MAS.DATASET_NM 스냅샷으로 남는다)
-- ============================================================

-- 1) 노드 프롬프트 버전 이력. 에이전트가 ACTIVE_YN='Y' 행을 읽어간다.
CREATE TABLE PTX_PROMPT_HIS (
    PROMPT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_NM         VARCHAR2(200) NOT NULL,
    VERSION_NO      VARCHAR2(20) NOT NULL,
    SYSTEM_CTN      CLOB,
    USER_CTN        CLOB,
    MODEL_NM        VARCHAR2(100),
    ACTIVE_YN       VARCHAR2(1) DEFAULT 'N',
    SUMMARY_CTN     VARCHAR2(500),
    REASON_CTN      VARCHAR2(1000),
    PREV_PROMPT_ID  NUMBER,
    USER_ID         VARCHAR2(50) NOT NULL,
    CRT_TM          TIMESTAMP DEFAULT SYSTIMESTAMP,
    UPDATE_TM       TIMESTAMP,
    CONSTRAINT UQ_PTX_PROMPT_HIS UNIQUE (NODE_NM, VERSION_NO),
    CONSTRAINT FK_PTX_PROMPT_PREV FOREIGN KEY (PREV_PROMPT_ID)
        REFERENCES PTX_PROMPT_HIS(PROMPT_ID) ON DELETE SET NULL
);

-- 2) 평가 데이터셋. ACTIVE_YN='N' 은 내부용(수동 호출 기록 sink)이라 목록에서 숨긴다.
CREATE TABLE PTX_DATASET_MAS (
    DATASET_ID      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_NM      VARCHAR2(200) NOT NULL,
    DESC_CTN        VARCHAR2(500),
    ACTIVE_YN       VARCHAR2(1) DEFAULT 'Y',
    USER_ID         VARCHAR2(50) NOT NULL,
    CRT_TM          TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 3) 데이터셋 케이스. INPUT_CTN 은 JSON: question/contexts/ground_truth.
CREATE TABLE PTX_DATASET_DET (
    CASE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_ID      NUMBER NOT NULL,
    INPUT_CTN       CLOB NOT NULL,
    EXPECT_CTN      CLOB,
    CRITERIA_CTN    CLOB,
    TYPE_CD         VARCHAR2(50) DEFAULT 'NORMAL',
    USER_ID         VARCHAR2(50) NOT NULL,
    CRT_TM          TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PTX_DATASET_DET_MAS FOREIGN KEY (DATASET_ID)
        REFERENCES PTX_DATASET_MAS(DATASET_ID) ON DELETE CASCADE
);

-- 4) 평가 실행 1건. PROMPT_ID 는 A/B 대상 버전, AB_GROUP_ID 는 비교 쌍 식별자.
--    ENGINE_CD='direct' 는 채점 없는 수동 호출, 'exact' 는 정답 일치만 채점한 실행.
--    DATASET_NM 은 실행 시점 스냅샷 — 데이터셋이 지워져도 기록에 이름이 남는다.
--    MODEL_CTN 도 스냅샷 — 실행 시작 시점의 PTX_MODEL_MAS 지정값이다. 이게 없으면
--    "모델 바꾸기 전/후" 두 실행을 나중에 구분할 수 없다.
CREATE TABLE PTX_RUN_MAS (
    RUN_ID               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PROMPT_ID            NUMBER,
    AB_GROUP_ID          NUMBER,
    DATASET_ID           NUMBER,
    DATASET_NM           VARCHAR2(200),
    STATUS_CD            VARCHAR2(20) DEFAULT 'PENDING',
    EXACT_VAL            NUMBER(5,4),
    FAITH_VAL            NUMBER(5,4),
    ANS_RELEVANCY_VAL    NUMBER(5,4),
    CNTX_PRECISION_VAL   NUMBER(5,4),
    CNTX_RECALL_VAL      NUMBER(5,4),
    ANS_CORRECTNESS_VAL  NUMBER(5,4),
    JUDGE_PROVIDER_CD    VARCHAR2(50),
    JUDGE_MODEL_NM       VARCHAR2(100),
    MODEL_CTN            CLOB,
    METRIC_CTN           CLOB,
    ENGINE_CD            VARCHAR2(20),
    ERROR_CTN            CLOB,
    START_TM             TIMESTAMP,
    END_TM               TIMESTAMP,
    USER_ID              VARCHAR2(50) NOT NULL,
    CRT_TM               TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PTX_RUN_MAS_PROMPT FOREIGN KEY (PROMPT_ID)
        REFERENCES PTX_PROMPT_HIS(PROMPT_ID) ON DELETE SET NULL,
    CONSTRAINT FK_PTX_RUN_MAS_DATASET FOREIGN KEY (DATASET_ID)
        REFERENCES PTX_DATASET_MAS(DATASET_ID) ON DELETE SET NULL
);

-- 5) 케이스별 결과.
--    TRACE_* 는 응답에 안 실리는 중간 변수를 채점한 경우에만 채워진다.
--    TRACE_CTN 은 PTX_TRACE_HIS 에서 읽어온 값의 스냅샷(트레이스는 보존기간이 지나면
--    지우지만 실행 기록은 남아야 한다). 값이 있으면 EXACT_VAL 은 ANSWER_CTN 이 아니라
--    이 값을 정답지와 비교한 결과다.
CREATE TABLE PTX_RUN_DET (
    RESULT_ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RUN_ID               NUMBER NOT NULL,
    CASE_ID              NUMBER,
    QUESTION_CTN         CLOB,
    ANSWER_CTN           CLOB,
    CNTX_CTN             CLOB,
    TRUTH_CTN            CLOB,
    TRACE_ID             VARCHAR2(50),
    TRACE_VAR_NM         VARCHAR2(100),
    TRACE_CTN            CLOB,
    EXACT_VAL            NUMBER(5,4),
    FAITH_VAL            NUMBER(5,4),
    ANS_RELEVANCY_VAL    NUMBER(5,4),
    CNTX_PRECISION_VAL   NUMBER(5,4),
    CNTX_RECALL_VAL      NUMBER(5,4),
    ANS_CORRECTNESS_VAL  NUMBER(5,4),
    ERROR_CTN            CLOB,
    CRT_TM               TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_PTX_RUN_DET_MAS FOREIGN KEY (RUN_ID)
        REFERENCES PTX_RUN_MAS(RUN_ID) ON DELETE CASCADE,
    CONSTRAINT FK_PTX_RUN_DET_CASE FOREIGN KEY (CASE_ID)
        REFERENCES PTX_DATASET_DET(CASE_ID) ON DELETE SET NULL
);

-- 6) 변경 감사 로그 (FK 없음 — 대상 row 가 지워져도 로그는 남는다).
CREATE TABLE PTX_AUDIT_HIS (
    LOG_ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TARGET_TABLE_NM  VARCHAR2(50) NOT NULL,
    TARGET_ID        NUMBER NOT NULL,
    ACTION_CD        VARCHAR2(20) NOT NULL,
    BEFORE_CTN       CLOB,
    AFTER_CTN        CLOB,
    USER_ID          VARCHAR2(50) NOT NULL,
    CRT_TM           TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 7) 에이전트가 호출 도중에 남기는 중간 변수. 응답에 실을 수 없는 값(예: 슬롯 파싱
--    노드의 `parsed`)을 채점하려고 에이전트가 직접 INSERT 한다 — PTX 는 읽기만 한다.
--    상관키는 PTX 가 발급해 session_system_prompt 의 TRACE_ID 로 실어 보낸 값.
--    FK 없음: 에이전트가 먼저 쓰고 PTX 가 나중에 읽는 순서라 부모 행이 아직 없다.
--    그래서 cascade 도 없다 — 실행 기록 삭제 시 PTX 가 TRACE_ID 로 직접 지운다.
--    어느 실행에도 안 붙은 행은 보존기간을 정해 주기적으로 지운다
--    (실행 기록엔 PTX_RUN_DET.TRACE_CTN 스냅샷으로 남는다).
CREATE TABLE PTX_TRACE_HIS (
    TRACE_SEQ_ID  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TRACE_ID      VARCHAR2(50) NOT NULL,
    VAR_NM        VARCHAR2(100),
    VAR_CTN       CLOB,
    CRT_TM        TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 8) 외부 에이전트의 LLM role 별 모델명. PTX 만 읽고 쓴다 — 여기 지정한 값을 PTX 가
--    호출마다 session_system_prompt 의 MODEL_OVERRIDE 로 실어 보내고, 에이전트는 그
--    호출에만 적용한다. 그래서 운영 트래픽은 무영향이고("테스트 중" 플래그가 필요 없다),
--    A/B 는 B 쪽에만 다른 모델을 실을 수 있다(이 표는 A = 기준값).
--    ROLE_CD 는 에이전트 LLMModel enum 의 멤버 이름(.name)과 글자까지 같아야 한다.
--    enum 의 value 는 실제 모델명이 아니라 라벨이라 쓰지 않는다.
--    endpoint / api_key 는 role 공통이라 에이전트 config 에 그대로 둔다. 키를 여기
--    넣으면 PTX_AUDIT_HIS 의 before/after 스냅샷에 평문으로 복사된다.
CREATE TABLE PTX_MODEL_MAS (
    MODEL_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ROLE_CD      VARCHAR2(30) NOT NULL,
    MODEL_NM     VARCHAR2(200),
    TEMPERATURE  NUMBER(3,2),
    DESC_CTN     VARCHAR2(500),
    USER_ID      VARCHAR2(50) NOT NULL,
    UPDATE_TM    TIMESTAMP,
    CRT_TM       TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_MODEL_ROLE UNIQUE (ROLE_CD)
);

CREATE INDEX IDX_PTX_PROMPT_NODE  ON PTX_PROMPT_HIS (NODE_NM, ACTIVE_YN);
CREATE INDEX IDX_PTX_TRACE_ID     ON PTX_TRACE_HIS (TRACE_ID);
CREATE INDEX IDX_PTX_RUN_DET_RUN  ON PTX_RUN_DET (RUN_ID);
CREATE INDEX IDX_PTX_RUN_MAS_DS   ON PTX_RUN_MAS (DATASET_ID);
CREATE INDEX IDX_PTX_AUDIT_TARGET ON PTX_AUDIT_HIS (TARGET_TABLE_NM, TARGET_ID);

-- role seed. ★ 아래 4개는 가정값이다 — 에이전트 LLMModel 의 실제 멤버 이름으로 바꿔서
-- 넣을 것 (대소문자까지 일치해야 한다. 파이썬 enum 관례상 'LLM','VLM',... 일 가능성이 높다).
-- 확인:  python -c "from config.settings import LLMModel; print([e.name for e in LLMModel])"
-- 이후 추가·삭제는 /models 화면에서 한다. MODEL_NM 이 NULL 이면 에이전트는 자기 config 의
-- 기본 모델명을 그대로 쓴다.
INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('vlm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('light_llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('judge_llm', 'system');

COMMIT;
