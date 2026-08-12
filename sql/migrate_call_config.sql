-- ============================================================
-- 호출별 모델 지정 — 기존 DB 에 적용하는 마이그레이션
--
-- PTX 가 호출 직전에 "이 호출은 이 모델로" 를 한 행 남기고, 에이전트가 TRACE_ID 로
-- 읽어 그 호출에만 적용한다. PTX_TRACE_HIS 와 정확히 대칭이다
--   PTX_TRACE_HIS : 에이전트가 쓰고 PTX 가 읽는다
--   PTX_CALL_MAS  : PTX 가 쓰고 에이전트가 읽는다
-- 상관키는 양쪽 다 TRACE_ID — PTX 가 발급해 session_system_prompt 로 이미 보내던 값이라
-- 요청 형식은 바뀌지 않는다.
--
-- 행이 없으면 = 지정 없음 = 에이전트 config 그대로. 운영 트래픽은 TRACE_ID 가 없으므로
-- 조회 자체가 빗나가고, A/B 는 사이드마다 TRACE_ID 가 달라 자연히 갈린다.
--
-- MODEL_CTN 형식: {"LLM": {"model": "...", "temperature": 0.3}}
--   - 지정 없는 role 은 빠진다 (그 role 은 config 값 그대로)
--
-- 한 문장씩 실행할 것.
-- ============================================================

-- 1) 테이블. FK 없음 — 수동 호출은 실행 기록보다 이 행이 먼저 생긴다.
CREATE TABLE PTX_CALL_MAS (
    TRACE_ID   VARCHAR2(50) NOT NULL,
    RUN_ID     NUMBER,
    MODEL_CTN  CLOB,
    CRT_TM     TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT PK_PTX_CALL_MAS PRIMARY KEY (TRACE_ID)
);

CREATE INDEX IDX_PTX_CALL_RUN ON PTX_CALL_MAS (RUN_ID);

COMMIT;

-- 2) 에이전트 계정이 PTX 스키마와 다르면 읽기 권한이 필요하다
--    GRANT SELECT ON PTX_CALL_MAS TO <agent_user>;

-- 3) 확인
SELECT column_name, data_type FROM user_tab_columns
 WHERE table_name = 'PTX_CALL_MAS' ORDER BY column_id;

-- 4) 보존 — 실행을 지우면 PTX 가 RUN_ID 로 같이 지운다. 어느 실행에도 안 붙은 행
--    (수동 호출이 기록 전에 실패한 경우 등)은 주기적으로 정리한다.
--    DELETE FROM PTX_CALL_MAS WHERE RUN_ID IS NULL AND CRT_TM < SYSTIMESTAMP - 7;
