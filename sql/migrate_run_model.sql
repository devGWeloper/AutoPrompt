-- ============================================================
-- 실행 기록에 모델 스냅샷 — 기존 DB 에 적용하는 마이그레이션
--
-- 실행을 시작할 때 PTX_MODEL_MAS 의 지정값을 JSON 으로 찍어 둔다. 이게 없으면
-- "모델 바꾸기 전 실행"과 "바꾼 뒤 실행"을 Records 에서 구분할 수 없다
-- (PTX_MODEL_MAS 는 현재 값 하나만 들고 있으므로 과거를 되짚을 수 없다).
--
-- 형식: {"LLM": {"model": "...", "temperature": 0.3}, "VLM": {"model": "..."}}
--   - 지정이 없는 role 은 아예 빠진다 (= 에이전트 config 기본값으로 돈 것)
--   - temperature 는 지정됐을 때만 실린다
--   - 아무 role 도 지정 안 됐으면 컬럼 자체가 NULL
--
-- JUDGE_MODEL_NM 과 헷갈리지 말 것 — 그쪽은 RAGAS 채점용 심판 LLM 이라 별개다.
--
-- 한 문장씩 실행할 것. 앱(dev 서버)이 떠 있으면 ALTER 가 ORA-00054 로 막힐 수
-- 있으니 먼저 내린다.
-- ============================================================

ALTER TABLE PTX_RUN_MAS ADD (MODEL_CTN CLOB);

COMMIT;

-- 확인 — 한 행이 나오면 정상. 기존 실행 기록은 NULL 로 남는다(그때 값을 알 길이 없다).
SELECT column_name, data_type FROM user_tab_columns
 WHERE table_name = 'PTX_RUN_MAS' AND column_name = 'MODEL_CTN';
