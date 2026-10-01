-- ============================================================
-- migrate_llm_server.sql
--   LLM 서버 레지스트리 추가.
--
--   PTX_LLM_MAS 는 지금까지 모델 '이름' 만 들고 있었다. 실제로는 모델마다
--   떠 있는 서버(주소)가 달라서, 실행 화면에서 모델을 골라도 에이전트는
--   자기 config 의 base_url 한 곳으로만 호출했다 — 즉 주소는 아무도
--   관리하지 않고 있었다. 모델을 서버에 붙여 두고, 실행이 고른 모델의
--   주소가 PTX_CALL_MAS.MODEL_CTN 에 같이 실려 가게 한다.
--
--   PTX_LLMSVR_MAS       : 모델이 떠 있는 서버 (BASE_URL + 키 '이름')
--   PTX_LLM_MAS.SERVER_ID: 그 모델이 어느 서버에 있는지. NULL = 지정 없음
--                          (에이전트가 자기 config 의 주소를 그대로 쓴다)
--
--   ⚠ API 키 '값' 은 DB 에 들어가지 않는다. KEY_REF 는 PTX config.yml 의
--     llmKeys 항목 이름일 뿐이고, 실제 값은 PTX 가 호출할 때 config 에서
--     꺼내 요청 헤더(X-PTX-LLM-KEYS)로만 에이전트에 넘긴다. 그래서 실행
--     스냅샷·감사로그·CSV 어디에도 키가 복제되지 않는다.
--     자세한 계약은 docs/model-roles-agent.md §1-1.
-- ============================================================

CREATE TABLE PTX_LLMSVR_MAS (
    SERVER_ID   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    SERVER_NM   VARCHAR2(100) NOT NULL,
    BASE_URL    VARCHAR2(500) NOT NULL,   -- OpenAI 호환 base_url  ex) http://10.0.0.5:8000/v1
    KEY_REF     VARCHAR2(100),            -- 키 '이름' (config.yml llmKeys). 키 값이 아니다
    DESC_CTN    VARCHAR2(500),
    ACTIVE_YN   CHAR(1) DEFAULT 'Y' NOT NULL,
    USER_ID     VARCHAR2(50) NOT NULL,
    UPDATE_TM   TIMESTAMP,
    CRT_TM      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_LLMSVR_NM UNIQUE (SERVER_NM)
);

ALTER TABLE PTX_LLM_MAS ADD (SERVER_ID NUMBER);

ALTER TABLE PTX_LLM_MAS ADD CONSTRAINT FK_PTX_LLM_SERVER
    FOREIGN KEY (SERVER_ID) REFERENCES PTX_LLMSVR_MAS(SERVER_ID);

-- 같은 모델명이 서버마다 떠 있을 수 있으므로 이름만으로는 더 이상 유일하지 않다.
ALTER TABLE PTX_LLM_MAS DROP CONSTRAINT UQ_PTX_LLM_NM;
ALTER TABLE PTX_LLM_MAS ADD CONSTRAINT UQ_PTX_LLM_NM_SVR UNIQUE (LLM_NM, SERVER_ID);

COMMIT;
