-- ============================================================
-- 데이터셋 폴더 — 기존 DB 에 적용하는 마이그레이션
--
-- 데이터셋 하나 안에서 케이스를 여러 묶음으로 나누기 위한 폴더 목록이다.
-- 폴더는 데이터셋에 속한다 — 같은 이름의 '요약' 폴더가 데이터셋마다 따로 있고,
-- 서로 아무 상관이 없다. 케이스가 어느 폴더에 있는지는 PTX_DATASET_DET.TYPE_CD 다.
--
-- 목록을 따로 두는 이유는 '빈 폴더' 다. 케이스에 붙은 값만 모아 보면 폴더는
-- 첫 케이스가 들어와야 생기고 마지막 케이스가 나가면 사라진다 — 폴더를 먼저
-- 만들어 두고 채우는 순서가 불가능해진다.
--
-- 'NORMAL' 은 TYPE_CD 의 컬럼 기본값이자 '폴더 없음' 을 뜻하는 예약값이라
-- 폴더로 만들 수 없다.
--
-- ※ 이 파일의 이전 버전(전역 PTX_CASETYPE_MAS)을 이미 실행했다면 아래 DROP 을
--   먼저 한 번 실행할 것. 그 버전은 화면 어디에서도 쓰지 않는다.
--   DROP TABLE PTX_CASETYPE_MAS PURGE;
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- ============================================================

-- 1) 테이블. 데이터셋이 지워지면 폴더도 같이 지워진다 — 폴더는 데이터셋의 일부다.
CREATE TABLE PTX_CASETYPE_MAS (
    TYPE_ID    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DATASET_ID NUMBER NOT NULL,
    TYPE_CD    VARCHAR2(50) NOT NULL,
    USER_ID    VARCHAR2(50) NOT NULL,
    UPDATE_TM  TIMESTAMP,
    CRT_TM     TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_PTX_CASETYPE UNIQUE (DATASET_ID, TYPE_CD),
    CONSTRAINT FK_PTX_CASETYPE_DATASET FOREIGN KEY (DATASET_ID)
        REFERENCES PTX_DATASET_MAS(DATASET_ID) ON DELETE CASCADE
);

-- 2) 이미 케이스에 붙어 있는 값을 그 데이터셋의 폴더로 끌어올린다. 이게 없으면
--    기존 케이스가 전부 '목록에 없음' 으로 보인다.
INSERT INTO PTX_CASETYPE_MAS (DATASET_ID, TYPE_CD, USER_ID)
SELECT DISTINCT DATASET_ID, TRIM(TYPE_CD), 'MIGRATION' FROM PTX_DATASET_DET
 WHERE TYPE_CD IS NOT NULL AND TRIM(TYPE_CD) NOT IN ('', 'NORMAL');

COMMIT;
