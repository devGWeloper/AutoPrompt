"""Make flow-level RAGAS the only test path; drop everything else.

Drops the non-RAGAS test tables (PM_TEST_RUN / PM_TEST_RESULT) and the flow
version-history tables (PM_FLOW_VER / PM_FLOW_VER_NODE), plus columns made dead by
the change: PM_RAGAS_RUN.{NODE_MAS_ID,PROMPT_ID} (RAGAS is FLOW-scoped only now) and
PM_NODE_PROMPT_VER LLM params (no per-node LLM invocation remains). Oracle-oriented;
SQLite tests build the schema from the models via create_all.

Revision ID: 0008
Revises: 0007
"""
from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dead columns (single-column FKs drop with the column on Oracle).
    op.execute("ALTER TABLE PM_RAGAS_RUN DROP (NODE_MAS_ID, PROMPT_ID)")
    op.execute(
        "ALTER TABLE PM_NODE_PROMPT_VER DROP (MODEL_NM, TEMPERATURE, MAX_TOKENS, TOP_P, EXTRA_PARAMS)"
    )
    # Dead tables (children before parents handled by CASCADE CONSTRAINTS).
    op.execute("DROP TABLE PM_TEST_RESULT CASCADE CONSTRAINTS PURGE")
    op.execute("DROP TABLE PM_TEST_RUN CASCADE CONSTRAINTS PURGE")
    op.execute("DROP TABLE PM_FLOW_VER_NODE CASCADE CONSTRAINTS PURGE")
    op.execute("DROP TABLE PM_FLOW_VER CASCADE CONSTRAINTS PURGE")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE PM_FLOW_VER (
            FLOW_VER_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            CHAT_VER_ID     NUMBER NOT NULL,
            FLOW_VERSION_NO VARCHAR2(20) NOT NULL,
            GRAPH_STRUCT    CLOB,
            MAIN_MODEL_NM   VARCHAR2(100),
            IS_ACTIVE       VARCHAR2(1) DEFAULT 'N',
            CHANGE_SUMMARY  VARCHAR2(500),
            CHANGE_REASON   VARCHAR2(1000),
            CREATED_BY      VARCHAR2(50) NOT NULL,
            CREATED_DT      TIMESTAMP DEFAULT SYSTIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE PM_FLOW_VER_NODE (
            ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            FLOW_VER_ID NUMBER NOT NULL REFERENCES PM_FLOW_VER(FLOW_VER_ID),
            NODE_MAS_ID NUMBER NOT NULL,
            NODE_NM     VARCHAR2(200) NOT NULL,
            PROMPT_ID   NUMBER REFERENCES PM_NODE_PROMPT_VER(PROMPT_ID),
            VERSION_NO  VARCHAR2(20)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE PM_TEST_RUN (
            RUN_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            RUN_TYPE       VARCHAR2(20) NOT NULL,
            NODE_MAS_ID    NUMBER REFERENCES NODE_MAS(ID),
            CHAT_VER_ID    NUMBER REFERENCES CHAT_VER_MAS(ID),
            PROMPT_ID      NUMBER REFERENCES PM_NODE_PROMPT_VER(PROMPT_ID),
            DATASET_ID     NUMBER REFERENCES PM_TEST_DATASET(DATASET_ID),
            AB_GROUP_ID    NUMBER,
            STATUS         VARCHAR2(20) DEFAULT 'PENDING',
            TOTAL_CASES    NUMBER DEFAULT 0,
            PASSED_CASES   NUMBER DEFAULT 0,
            FAILED_CASES   NUMBER DEFAULT 0,
            AVG_LATENCY_MS NUMBER,
            TOTAL_TOKENS   NUMBER,
            STARTED_DT     TIMESTAMP,
            ENDED_DT       TIMESTAMP,
            CREATED_BY     VARCHAR2(50) NOT NULL,
            CREATED_DT     TIMESTAMP DEFAULT SYSTIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE PM_TEST_RESULT (
            RESULT_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            RUN_ID        NUMBER NOT NULL REFERENCES PM_TEST_RUN(RUN_ID),
            CASE_ID       NUMBER REFERENCES PM_TEST_CASE(CASE_ID),
            ACTUAL_OUTPUT CLOB,
            IS_PASSED     VARCHAR2(1),
            EVAL_DETAIL   CLOB,
            LATENCY_MS    NUMBER,
            INPUT_TOKENS  NUMBER,
            OUTPUT_TOKENS NUMBER,
            ERROR_MSG     VARCHAR2(1000),
            EXECUTED_DT   TIMESTAMP DEFAULT SYSTIMESTAMP
        )
        """
    )
    op.execute(
        "ALTER TABLE PM_NODE_PROMPT_VER ADD ("
        "MODEL_NM VARCHAR2(100), TEMPERATURE NUMBER(3,2), MAX_TOKENS NUMBER, "
        "TOP_P NUMBER(3,2), EXTRA_PARAMS CLOB)"
    )
    op.execute(
        "ALTER TABLE PM_RAGAS_RUN ADD ("
        "NODE_MAS_ID NUMBER REFERENCES NODE_MAS(ID), "
        "PROMPT_ID NUMBER REFERENCES PM_NODE_PROMPT_VER(PROMPT_ID))"
    )
