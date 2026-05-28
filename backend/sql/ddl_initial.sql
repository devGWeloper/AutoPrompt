-- ============================================================
-- AI Agent Prompt Management (PM) — current PM-owned schema DDL
-- Target: Oracle 19c+ / XE 21c (also runs on 12c+ with IDENTITY)
--
-- Authoritative source = backend/app/models/* (this file mirrors them).
-- RAGAS is FLOW-scoped only; non-RAGAS test tables and flow-version history were
-- removed (alembic 0008_ragas_main_cleanup). PM owns 6 tables here.
--
-- Agent-owned tables CHAT_VER_MAS / NODE_MAS / MODEL_MAS are NEVER created or
-- altered by PM (they already exist in the shared DB); PM only references them by
-- FK. A commented appendix at the end reproduces them for an empty local dev DB.
-- ============================================================

-- 1) Node prompt version history (PM-owned). The agent reads the active row.
CREATE TABLE PM_NODE_PROMPT_VER (
    PROMPT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_MAS_ID     NUMBER NOT NULL REFERENCES NODE_MAS(ID),
    NODE_NM         VARCHAR2(200) NOT NULL,
    VERSION_NO      VARCHAR2(20) NOT NULL,
    SYSTEM_PROMPT   CLOB,
    USER_PROMPT     CLOB,
    IS_ACTIVE       VARCHAR2(1) DEFAULT 'N',
    CHANGE_SUMMARY  VARCHAR2(500),
    CHANGE_REASON   VARCHAR2(1000),
    PREV_PROMPT_ID  NUMBER REFERENCES PM_NODE_PROMPT_VER(PROMPT_ID),
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP,
    UPDATED_DT      TIMESTAMP,
    CONSTRAINT UQ_PM_NODE_PROMPT_VER UNIQUE (NODE_MAS_ID, VERSION_NO)
);

-- 2) Test dataset (RAGAS golden set). FLOW-scoped datasets have NODE_MAS_ID NULL.
CREATE TABLE PM_TEST_DATASET (
    DATASET_ID      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    NODE_MAS_ID     NUMBER REFERENCES NODE_MAS(ID),
    SCOPE           VARCHAR2(10) DEFAULT 'NODE',
    DATASET_NM      VARCHAR2(200) NOT NULL,
    DESCRIPTION     VARCHAR2(500),
    IS_ACTIVE       VARCHAR2(1) DEFAULT 'Y',
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 3) Test case (one golden Q/A; input_data is JSON: question/contexts/ground_truth).
CREATE TABLE PM_TEST_CASE (
    CASE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_ID      NUMBER NOT NULL REFERENCES PM_TEST_DATASET(DATASET_ID),
    INPUT_DATA      CLOB NOT NULL,
    EXPECTED_OUTPUT CLOB,
    EVAL_CRITERIA   CLOB,
    CASE_TYPE       VARCHAR2(50) DEFAULT 'NORMAL',
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 4) RAGAS run (flow-scoped aggregate). The whole flow (CHAT_VER_MAS) is evaluated.
CREATE TABLE PM_RAGAS_RUN (
    RAGAS_RUN_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CHAT_VER_ID        NUMBER REFERENCES CHAT_VER_MAS(ID),
    DATASET_ID         NUMBER NOT NULL REFERENCES PM_TEST_DATASET(DATASET_ID),
    STATUS             VARCHAR2(20) DEFAULT 'PENDING',
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
    CREATED_BY         VARCHAR2(50) NOT NULL,
    CREATED_DT         TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 5) RAGAS per-case result.
CREATE TABLE PM_RAGAS_RESULT (
    RAGAS_RESULT_ID    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RAGAS_RUN_ID       NUMBER NOT NULL REFERENCES PM_RAGAS_RUN(RAGAS_RUN_ID),
    CASE_ID            NUMBER REFERENCES PM_TEST_CASE(CASE_ID),
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
    CREATED_DT         TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 6) Audit log (prompt create/edit/activate history).
CREATE TABLE PM_AUDIT_LOG (
    LOG_ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TARGET_TABLE    VARCHAR2(50) NOT NULL,
    TARGET_ID       NUMBER NOT NULL,
    ACTION          VARCHAR2(20) NOT NULL,
    BEFORE_VALUE    CLOB,
    AFTER_VALUE     CLOB,
    CREATED_BY      VARCHAR2(50) NOT NULL,
    CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX IDX_PM_PROMPT_NODENM_ACT ON PM_NODE_PROMPT_VER (NODE_NM, IS_ACTIVE);
CREATE INDEX IDX_PM_PROMPT_NODE       ON PM_NODE_PROMPT_VER (NODE_MAS_ID);
CREATE INDEX IDX_PM_RAGASRESULT_RUN   ON PM_RAGAS_RESULT (RAGAS_RUN_ID);
CREATE INDEX IDX_PM_AUDIT_TARGET      ON PM_AUDIT_LOG (TARGET_TABLE, TARGET_ID);

-- ============================================================
-- Appendix (DEV ONLY): agent-owned external tables. The shared/prod DB ALREADY
-- has these — do NOT run this section there. Use only on an empty local dev DB so
-- the PM FKs above resolve. PKs use BY DEFAULT so demo seeds can insert explicit ids.
-- ============================================================
-- CREATE TABLE CHAT_VER_MAS (
--     ID            NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     GRAPH_STRUCT  CLOB,
--     MAIN_MODEL_NM VARCHAR2(100),
--     CREATE_DATE   TIMESTAMP DEFAULT SYSTIMESTAMP,
--     UPDATE_DATE   TIMESTAMP,
--     CREATE_USER   VARCHAR2(50),
--     UPDATE_USER   VARCHAR2(50)
-- );
-- CREATE TABLE NODE_MAS (
--     ID                        NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     CHAT_VER_ID               NUMBER NOT NULL REFERENCES CHAT_VER_MAS(ID),
--     NODE_NM                   VARCHAR2(200) NOT NULL,
--     MODEL_NM                  VARCHAR2(100),
--     NODE_DESC                 VARCHAR2(1000),
--     PROMPT                    CLOB,
--     PROMPT_EDIT_ENABLE_YN     VARCHAR2(1) DEFAULT 'N',
--     MODEL_EDIT_ENABLE_YN      VARCHAR2(1) DEFAULT 'N',
--     MAIN_MODEL_EDIT_ENABLE_YN VARCHAR2(1) DEFAULT 'N',
--     CREATE_DATE               TIMESTAMP DEFAULT SYSTIMESTAMP,
--     UPDATE_DATE               TIMESTAMP,
--     CREATE_USER               VARCHAR2(50),
--     UPDATE_USER               VARCHAR2(50)
-- );
-- CREATE TABLE MODEL_MAS (
--     ID            NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     GAIA_MODEL_NM VARCHAR2(100) NOT NULL
-- );
