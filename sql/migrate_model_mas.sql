-- ============================================================
-- LLM role 별 모델 관리 — 기존 DB 에 적용하는 마이그레이션
--
-- 외부 에이전트 config 의 LLM 4종(llm / vlm / light_llm / judge_llm)을 PTX 화면에서
-- 조정하기 위한 테이블 — role 목록과 기본값이다. 실제 적용값은 실행 탭의 '모델' 칸이고,
-- 그 칸이 여기 값으로 미리 채워진다. 실행이 시작되면 화면에 있던 값이 PTX_CALL_MAS 로
-- 적히고 에이전트가 거기서 읽어 간다(docs/model-roles-agent.md).
-- endpoint / api_key 는 계속 에이전트 config 에 둔다.
-- ※ 이 테이블만으로는 적용이 안 된다 — sql/migrate_call_config.sql 도 같이 돌릴 것.
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- ============================================================

-- 1) 테이블. ROLE_CD 는 에이전트 LLMModel enum 의 멤버 이름(.name)과 글자까지 같아야 한다
--    (enum 의 value 는 실제 모델명이 아니라 라벨이라 쓰지 않는다).
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

-- 2) role seed. 실제 enum 멤버 이름이 아래와 다르면 그 이름으로 바꿔서 넣을 것
--    (넣고 나서 /models 화면에서 추가·삭제해도 된다).
--    MODEL_NM 이 NULL 이면 실행 탭의 그 role 칸이 빈 채로 시작하고, 빈 채로 실행하면
--    에이전트가 자기 config 의 모델을 그대로 쓴다.
INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('vlm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('light_llm', 'system');

INSERT INTO PTX_MODEL_MAS (ROLE_CD, USER_ID) VALUES ('judge_llm', 'system');

COMMIT;

-- 3) 이 표에 대한 에이전트 권한은 필요 없다. 에이전트가 읽는 건 PTX_CALL_MAS 쪽이다.

-- 4) 확인 — 4행이 나오면 정상
SELECT ROLE_CD, MODEL_NM, TEMPERATURE FROM PTX_MODEL_MAS ORDER BY MODEL_ID;
