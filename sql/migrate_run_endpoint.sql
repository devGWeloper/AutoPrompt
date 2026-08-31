-- ============================================================
-- 실행 기록에 엔드포인트 스냅샷 — 기존 DB 에 적용하는 마이그레이션
--
-- 실행이 어느 API 로 나갔는지를 실행 행에 적어 둔다. 지금까지는 이 값이 요청에만
-- 있고 어디에도 남지 않아서, 프롬프트도 모델도 바꾸지 않은 실행(기록에 'Default'
-- 로 뜨던 것)들이 서로 완전히 같아 보였다 — 실제로는 서로 다른 Agent 를 부른
-- 실행인데도.
--
-- 이름과 URL 을 둘 다 찍어 두는 건 DATASET_NM 과 같은 이유다: PTX_ENDPOINT_MAS
-- 의 행은 나중에 이름이 바뀌거나 지워질 수 있고, 그때 지난 실행이 가리키던 곳까지
-- 같이 바뀌면 기록이 거짓말을 하게 된다. ID 는 일부러 안 남긴다 — 등록이 지워지면
-- 매달릴 곳 없는 숫자만 남는다.
--
-- config.yml 의 기본 엔드포인트로 나간 실행은 이름이 'config.yml · A' 처럼 적힌다.
--
-- 한 문장씩 실행할 것. 앱(dev 서버)이 떠 있으면 ALTER 가 ORA-00054 로 막힐 수
-- 있으니 먼저 내린다.
-- ============================================================

ALTER TABLE PTX_RUN_MAS ADD (ENDPOINT_NM VARCHAR2(100), ENDPOINT_URL VARCHAR2(500));

COMMIT;

-- 확인 — 두 행이 나오면 정상. 기존 실행 기록은 NULL 로 남고, 화면에서는 지금까지와
-- 똑같이 'Default' 로 뜬다 (그때 어디로 보냈는지는 알 길이 없다).
SELECT column_name, data_type, data_length FROM user_tab_columns
 WHERE table_name = 'PTX_RUN_MAS' AND column_name IN ('ENDPOINT_NM', 'ENDPOINT_URL');
