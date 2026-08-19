-- ============================================================
-- 케이스별 소요시간 — 기존 DB 에 적용하는 마이그레이션
--
-- 실행 중 SSE 로 흘러가는 시간은 새로고침하면 사라진다. 기록 탭에서 지난 실행을
-- 열었을 때도 케이스마다 몇 초 걸렸는지 보이게 하려면 저장할 컬럼이 필요하다.
-- ELAPSED_MS 는 에이전트 호출 1건에 걸린 시간(ms)이다 — 채점(RAGAS) 시간은
-- 포함하지 않는다. 타임아웃으로 끊긴 케이스도 끊길 때까지 걸린 시간이 남는다.
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- 앱(dev 서버)이 떠 있으면 ALTER 가 ORA-00054 로 막힐 수 있으니 먼저 내린다.
-- ============================================================

ALTER TABLE PTX_RUN_DET ADD (ELAPSED_MS NUMBER);

COMMIT;

-- 확인 — 컬럼이 보이면 정상. 기존 행은 NULL 이고 UI 에서는 시간이 비어 보인다.
SELECT column_name, data_type FROM user_tab_columns
 WHERE table_name = 'PTX_RUN_DET' AND column_name = 'ELAPSED_MS';
