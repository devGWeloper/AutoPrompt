-- ============================================================
-- 최초 실행 구간 보존 — 기존 DB 에 적용하는 마이그레이션
--
-- 불일치/선택 재실행은 새 기록을 만들지 않고 그 실행을 그 자리에서 다시 돌린다.
-- 그때 START_TM / END_TM 이 이번 실행 구간으로 다시 찍히므로, 처음 돌렸을 때
-- 얼마나 걸렸는지는 덮여 사라진다. 24건을 처음 돌린 338초와 불일치 3건만 다시
-- 돌린 12초는 다른 사실이고, 둘 다 남아야 "원래 이만큼 걸리던 실행" 을 잃지 않는다.
--
-- 그래서 최초 구간만 따로 붙든다:
--   FIRST_START_TM / FIRST_END_TM — 이 실행이 처음 돌았을 때의 시작 · 종료.
--                                   한 번 채워지면 재실행이 덮지 않는다.
--   START_TM / END_TM             — 가장 최근 실행(= 마지막 재실행) 구간. 그대로다.
--
-- 재실행한 적이 없는 실행은 두 쌍이 같은 값이고, 화면도 한 줄만 보여 준다.
--
-- 이 마이그레이션을 돌리지 않아도 앱은 그대로 동작한다 — 컬럼이 없으면 저장을
-- 건너뛰고, 화면은 지금처럼 마지막 실행 구간만 보여 준다. 돌린 뒤부터 새로 도는
-- 실행에 최초 구간이 남는다(이미 있던 행은 NULL 이라 예전과 같이 보인다).
--
-- 한 문장씩 실행할 것. 중간에 빈 줄을 넣지 말 것(SQL*Plus 가 문장을 끊는다).
-- 앱(dev 서버)이 떠 있으면 ALTER 가 ORA-00054 로 막힐 수 있으니 먼저 내린다.
-- ============================================================

ALTER TABLE PTX_RUN_MAS ADD (FIRST_START_TM TIMESTAMP, FIRST_END_TM TIMESTAMP);

COMMIT;

-- 이미 쌓여 있는 실행은 아직 재실행된 적이 없으므로 지금의 구간이 곧 최초 구간이다.
UPDATE PTX_RUN_MAS SET FIRST_START_TM = START_TM, FIRST_END_TM = END_TM WHERE START_TM IS NOT NULL;

COMMIT;

-- 확인 — 컬럼이 보이면 정상.
SELECT column_name, data_type FROM user_tab_columns
 WHERE table_name = 'PTX_RUN_MAS' AND column_name IN ('FIRST_START_TM', 'FIRST_END_TM');
