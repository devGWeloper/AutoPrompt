-- ============================================================
-- 중간 변수 채점 — 기존 DB 에 적용하는 마이그레이션
--
-- 응답에 실리지 않는 중간 변수(예: 슬롯 파싱 노드의 `parsed`)를 정답지와 비교하려면
-- 에이전트가 그 값을 남길 곳과, 실행 기록이 그걸 붙잡아 둘 컬럼이 필요하다.
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- 앱(dev 서버)이 떠 있으면 ALTER 가 ORA-00054 로 막힐 수 있으니 먼저 내린다.
-- ============================================================

-- 1) 에이전트가 중간 변수를 쓰는 테이블
CREATE TABLE PTX_TRACE_HIS (
    TRACE_SEQ_ID  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TRACE_ID      VARCHAR2(50) NOT NULL,
    VAR_NM        VARCHAR2(100),
    VAR_CTN       CLOB,
    CRT_TM        TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX IDX_PTX_TRACE_ID ON PTX_TRACE_HIS (TRACE_ID);

-- 2) 실행 기록이 채점 대상을 스냅샷으로 붙잡아 둔다
--    (PTX_TRACE_HIS 는 보존기간이 지나면 지우지만 실행 기록은 남아야 한다)
ALTER TABLE PTX_RUN_DET ADD (TRACE_ID VARCHAR2(50));

ALTER TABLE PTX_RUN_DET ADD (TRACE_VAR_NM VARCHAR2(100));

ALTER TABLE PTX_RUN_DET ADD (TRACE_CTN CLOB);

COMMIT;

-- 3) 에이전트 계정에 쓰기 권한 (PTX 스키마와 다른 계정으로 접속할 때만)
--    GRANT INSERT ON PTX_TRACE_HIS TO <agent_user>;

-- 4) 확인 — 3개 컬럼과 테이블이 보이면 정상
SELECT table_name, column_name FROM user_tab_columns
 WHERE (table_name = 'PTX_RUN_DET' AND column_name LIKE 'TRACE%')
    OR table_name = 'PTX_TRACE_HIS'
 ORDER BY table_name, column_name;
