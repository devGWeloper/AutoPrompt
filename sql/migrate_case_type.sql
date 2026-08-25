-- ============================================================
-- 케이스 분류 목록 — 기존 DB 에 적용하는 마이그레이션
--
-- PTX_DATASET_DET.TYPE_CD 는 케이스 하나의 분류다. 지금까지는 아무 문자열이나
-- 들어갈 수 있었는데, 분류는 미리 정해 두고 고르는 값이라 목록을 따로 둔다.
-- 데이터셋 화면의 분류 칸이 이 목록을 드롭다운으로 보여준다.
--
-- 실행 기록/케이스와 FK 로 엮지 않는다 — 다른 설정 테이블(PTX_ENDPOINT_MAS,
-- PTX_LLM_MAS)과 같은 이유다. 목록에서 분류를 지워도 그 분류로 저장된 케이스는
-- 값을 그대로 들고 있고, 화면에서는 '목록에 없음' 으로 표시된다.
--
-- 'NORMAL' 은 컬럼 기본값이자 '미분류' 를 뜻하는 예약값이라 목록에 넣지 않는다.
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- ============================================================

-- 1) 테이블
CREATE TABLE PTX_CASETYPE_MAS (
    TYPE_ID    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TYPE_CD    VARCHAR2(50) NOT NULL,
    DESC_CTN   VARCHAR2(500),
    ACTIVE_YN  CHAR(1) DEFAULT 'Y' NOT NULL,
    USER_ID    VARCHAR2(50) NOT NULL,
    UPDATE_TM  TIMESTAMP,
    CRT_TM     TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_CASETYPE_CD UNIQUE (TYPE_CD)
);

-- 2) 이미 케이스에 붙어 있는 분류를 목록으로 끌어올린다. 이게 없으면 기존 케이스가
--    전부 '미등록' 으로 보인다.
INSERT INTO PTX_CASETYPE_MAS (TYPE_CD, USER_ID)
SELECT DISTINCT TRIM(TYPE_CD), 'MIGRATION' FROM PTX_DATASET_DET
 WHERE TYPE_CD IS NOT NULL AND TRIM(TYPE_CD) NOT IN ('', 'NORMAL');

COMMIT;
