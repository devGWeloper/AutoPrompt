-- ============================================================
-- migrate_endpoint_llm.sql
--   설정 레지스트리 2종 추가 — 실행 화면에서 자유 입력을 없애고
--   "등록된 것 중에서만 고른다" 로 바꾸기 위한 테이블이다.
--
--   PTX_ENDPOINT_MAS : 호출 가능한 외부 API 목록 (URL + 헤더)
--   PTX_LLM_MAS      : 고를 수 있는 LLM 모델명 목록
--
--   둘 다 설정 테이블이라 실행 기록과 FK 로 엮지 않는다 — 실행은 시작 시점의
--   값을 스냅샷(PTX_RUN_MAS.MODEL_CTN 등)으로 들고 있으므로, 나중에 목록에서
--   지워도 과거 기록의 의미는 변하지 않는다.
-- ============================================================

CREATE TABLE PTX_ENDPOINT_MAS (
    ENDPOINT_ID   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ENDPOINT_NM   VARCHAR2(100) NOT NULL,
    ENDPOINT_URL  VARCHAR2(500) NOT NULL,
    HEADER_CTN    CLOB,                          -- [{"name":"auth-key","value":"..."}] JSON
    DESC_CTN      VARCHAR2(500),
    ACTIVE_YN     CHAR(1) DEFAULT 'Y' NOT NULL,
    USER_ID       VARCHAR2(50) NOT NULL,
    UPDATE_TM     TIMESTAMP,
    CRT_TM        TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_ENDPOINT_NM UNIQUE (ENDPOINT_NM)
);

CREATE TABLE PTX_LLM_MAS (
    LLM_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    LLM_NM     VARCHAR2(200) NOT NULL,
    DESC_CTN   VARCHAR2(500),
    ACTIVE_YN  CHAR(1) DEFAULT 'Y' NOT NULL,
    USER_ID    VARCHAR2(50) NOT NULL,
    UPDATE_TM  TIMESTAMP,
    CRT_TM     TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_LLM_NM UNIQUE (LLM_NM)
);

COMMIT;
