-- ============================================================
-- 스키마 점검 — 앱 코드가 쓰는 컬럼이 DB 에 다 있는지 확인한다.
-- 결과가 0건이면 정상. 행이 나오면 그 컬럼이 없는 것이다.
-- ============================================================
WITH expected AS (
  SELECT 'PTX_PROMPT_HIS'  AS t, 'PROMPT_ID'           AS c FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'NODE_NM'                FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'VERSION_NO'             FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'SYSTEM_CTN'             FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'USER_CTN'               FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'MODEL_NM'               FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'ACTIVE_YN'              FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'SUMMARY_CTN'            FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'REASON_CTN'             FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'PREV_PROMPT_ID'         FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'CRT_TM'                 FROM dual UNION ALL
  SELECT 'PTX_PROMPT_HIS',       'UPDATE_TM'              FROM dual UNION ALL

  SELECT 'PTX_DATASET_MAS',      'DATASET_ID'             FROM dual UNION ALL
  SELECT 'PTX_DATASET_MAS',      'DATASET_NM'             FROM dual UNION ALL
  SELECT 'PTX_DATASET_MAS',      'DESC_CTN'               FROM dual UNION ALL
  SELECT 'PTX_DATASET_MAS',      'ACTIVE_YN'              FROM dual UNION ALL
  SELECT 'PTX_DATASET_MAS',      'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_DATASET_MAS',      'CRT_TM'                 FROM dual UNION ALL

  SELECT 'PTX_DATASET_DET',      'CASE_ID'                FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'DATASET_ID'             FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'INPUT_CTN'              FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'EXPECT_CTN'             FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'CRITERIA_CTN'           FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'TYPE_CD'                FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_DATASET_DET',      'CRT_TM'                 FROM dual UNION ALL

  SELECT 'PTX_RUN_MAS',          'RUN_ID'                 FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'PROMPT_ID'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'AB_GROUP_ID'            FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'DATASET_ID'             FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'DATASET_NM'             FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'STATUS_CD'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'ENGINE_CD'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'METRIC_CTN'             FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'JUDGE_PROVIDER_CD'      FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'JUDGE_MODEL_NM'         FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'EXACT_VAL'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'FAITH_VAL'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'ANS_RELEVANCY_VAL'      FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'CNTX_PRECISION_VAL'     FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'CNTX_RECALL_VAL'        FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'ANS_CORRECTNESS_VAL'    FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'ERROR_CTN'              FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'START_TM'               FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'END_TM'                 FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_RUN_MAS',          'CRT_TM'                 FROM dual UNION ALL

  SELECT 'PTX_RUN_DET',          'RESULT_ID'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'RUN_ID'                 FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'CASE_ID'                FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'QUESTION_CTN'           FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'ANSWER_CTN'             FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'CNTX_CTN'               FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'TRUTH_CTN'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'EXACT_VAL'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'FAITH_VAL'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'ANS_RELEVANCY_VAL'      FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'CNTX_PRECISION_VAL'     FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'CNTX_RECALL_VAL'        FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'ANS_CORRECTNESS_VAL'    FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'ERROR_CTN'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'TRACE_ID'               FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'TRACE_VAR_NM'           FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'TRACE_CTN'              FROM dual UNION ALL
  SELECT 'PTX_RUN_DET',          'CRT_TM'                 FROM dual UNION ALL
  SELECT 'PTX_TRACE_HIS',        'TRACE_ID'               FROM dual UNION ALL
  SELECT 'PTX_TRACE_HIS',        'VAR_NM'                 FROM dual UNION ALL
  SELECT 'PTX_TRACE_HIS',        'VAR_CTN'                FROM dual UNION ALL
  SELECT 'PTX_TRACE_HIS',        'CRT_TM'                 FROM dual UNION ALL

  SELECT 'PTX_MODEL_MAS',       'MODEL_ID'               FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'ROLE_CD'                FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'MODEL_NM'               FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'TEMPERATURE'            FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'DESC_CTN'               FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'UPDATE_TM'              FROM dual UNION ALL
  SELECT 'PTX_MODEL_MAS',       'CRT_TM'                 FROM dual UNION ALL

  SELECT 'PTX_AUDIT_HIS',        'LOG_ID'                 FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'TARGET_TABLE_NM'        FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'TARGET_ID'              FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'ACTION_CD'              FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'BEFORE_CTN'             FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'AFTER_CTN'              FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'USER_ID'                FROM dual UNION ALL
  SELECT 'PTX_AUDIT_HIS',        'CRT_TM'                 FROM dual
)
SELECT e.t AS table_nm, e.c AS missing_column
  FROM expected e
 WHERE NOT EXISTS (SELECT 1 FROM user_tab_columns u
                    WHERE u.table_name = e.t AND u.column_name = e.c)
 ORDER BY e.t, e.c;

-- 남아 있는 옛 이름(있으면 그 컬럼은 아직 rename 이 안 된 것)
SELECT table_name, column_name
  FROM user_tab_columns
 WHERE table_name LIKE 'PTX\_%' ESCAPE '\'
   AND column_name IN ('CREATED_BY','CREATED_DT','UPDATED_DT','STARTED_DT','ENDED_DT',
                       'IS_ACTIVE','SYSTEM_PROMPT','USER_PROMPT','CHANGE_SUMMARY','CHANGE_REASON',
                       'DESCRIPTION','INPUT_DATA','EXPECTED_OUTPUT','EVAL_CRITERIA','CASE_TYPE',
                       'RAGAS_RUN_ID','RAGAS_RESULT_ID','STATUS','ENGINE','METRICS',
                       'JUDGE_PROVIDER','JUDGE_MODEL','ERROR_MSG','QUESTION','ANSWER','CONTEXTS',
                       'GROUND_TRUTH','EXACT_MATCH','FAITHFULNESS','ANSWER_RELEVANCY',
                       'CONTEXT_PRECISION','CONTEXT_RECALL','ANSWER_CORRECTNESS',
                       'TARGET_TABLE','ACTION','BEFORE_VALUE','AFTER_VALUE')
 ORDER BY table_name, column_name;

-- FK 삭제 규칙 확인 (CASCADE / SET NULL 이 붙어 있는지)
SELECT c.table_name, c.constraint_name, c.delete_rule, r.table_name AS parent_table
  FROM user_constraints c
  JOIN user_constraints r ON r.constraint_name = c.r_constraint_name
 WHERE c.constraint_type = 'R'
   AND c.table_name LIKE 'PTX\_%' ESCAPE '\'
 ORDER BY c.table_name;

-- DATASET_ID 가 NULL 허용으로 바뀌었는지 (데이터셋 삭제 시 실행 기록 보존에 필요)
SELECT column_name, nullable
  FROM user_tab_columns
 WHERE table_name = 'PTX_RUN_MAS' AND column_name IN ('DATASET_ID','DATASET_NM');
