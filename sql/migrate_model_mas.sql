-- ============================================================
-- LLM role 별 모델 관리 — 기존 DB 에 적용하는 마이그레이션
--
-- 외부 에이전트 config 의 LLM 4종(llm / vlm / light_llm / judge_llm)을 PTX 화면에서
-- 조정하기 위한 테이블. 적용은 에이전트가 한다 — 에이전트가 ROLE_CD 로 이 표를 읽어
-- 자기 config 의 모델명을 덮어쓴다(docs/model-roles-agent.md).
-- endpoint / api_key 는 4종 공통이라 계속 에이전트 config 에 둔다.
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- ============================================================

-- 1) 테이블. ROLE_CD 는 에이전트 LLMModel enum 의 value 와 글자까지 같아야 한다.
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

-- 2) role seed. 실제 enum value 가 아래와 다르면 그 이름으로 바꿔서 넣을 것
--    (넣고 나서 /models 화면에서 추가·삭제해도 된다).
--    MODEL_NM 이 NULL 이면 에이전트는 자기 config 의 기본 모델명을 그대로 쓴다.
INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('vlm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('light_llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('judge_llm', 'system');

COMMIT;

-- 3) 에이전트 계정이 PTX 스키마와 다르면 읽기 권한이 필요하다
--    GRANT SELECT ON PTX_MODEL_MAS TO <agent_user>;

-- 4) 확인 — 4행이 나오면 정상
SELECT ROLE_CD, MODEL_NM, TEMPERATURE FROM PTX_MODEL_MAS ORDER BY MODEL_ID;
