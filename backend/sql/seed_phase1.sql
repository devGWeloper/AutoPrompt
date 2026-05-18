-- ============================================================
-- Phase 1 seed data
-- bcrypt hashes are pre-computed:
--   admin / admin1234
--   user1 / user1234
-- Hash generated with: passlib.hash.bcrypt.hash("...")
-- ============================================================

INSERT INTO PM_USER (USERNAME, PASSWORD_HASH, DISPLAY_NM, ROLE) VALUES
  ('admin', '$2b$12$KIXQfQk6P5/4pV1WJ8mqEeOJq3p7QyL2v3F7L2YQv9p5d2lJ4xWmO', 'Administrator', 'ADMIN');
INSERT INTO PM_USER (USERNAME, PASSWORD_HASH, DISPLAY_NM, ROLE) VALUES
  ('user1', '$2b$12$Bn4q3F7L2YQv9p5d2lJ4xKIXQfQk6P5w4pV1WJ8mqEeOJq3p7QyL.', 'User One', 'USER');

INSERT INTO PM_PROJECT (PROJECT_NM, DESCRIPTION, CREATED_BY) VALUES
  ('Customer Support Agent', 'Demo AI Agent for customer inquiries', 'admin');

-- Nodes: START -> Router -> (IT LLM | General LLM) -> END
INSERT INTO PM_NODE (PROJECT_ID, NODE_KEY, NODE_NM, NODE_TYPE, POS_X, POS_Y, CREATED_BY) VALUES
  (1, 'start', 'Start', 'START', 100, 200, 'admin');
INSERT INTO PM_NODE (PROJECT_ID, NODE_KEY, NODE_NM, NODE_TYPE, POS_X, POS_Y, CREATED_BY) VALUES
  (1, 'router', 'Intent Router', 'ROUTER', 300, 200, 'admin');
INSERT INTO PM_NODE (PROJECT_ID, NODE_KEY, NODE_NM, NODE_TYPE, POS_X, POS_Y, CREATED_BY) VALUES
  (1, 'it_responder', 'IT Responder', 'LLM', 550, 100, 'admin');
INSERT INTO PM_NODE (PROJECT_ID, NODE_KEY, NODE_NM, NODE_TYPE, POS_X, POS_Y, CREATED_BY) VALUES
  (1, 'general_responder', 'General Responder', 'LLM', 550, 300, 'admin');
INSERT INTO PM_NODE (PROJECT_ID, NODE_KEY, NODE_NM, NODE_TYPE, POS_X, POS_Y, CREATED_BY) VALUES
  (1, 'end', 'End', 'END', 800, 200, 'admin');

INSERT INTO PM_NODE_EDGE (PROJECT_ID, SOURCE_NODE_ID, TARGET_NODE_ID, LABEL) VALUES (1, 1, 2, NULL);
INSERT INTO PM_NODE_EDGE (PROJECT_ID, SOURCE_NODE_ID, TARGET_NODE_ID, LABEL) VALUES (1, 2, 3, 'IT');
INSERT INTO PM_NODE_EDGE (PROJECT_ID, SOURCE_NODE_ID, TARGET_NODE_ID, LABEL) VALUES (1, 2, 4, 'General');
INSERT INTO PM_NODE_EDGE (PROJECT_ID, SOURCE_NODE_ID, TARGET_NODE_ID, LABEL) VALUES (1, 3, 5, NULL);
INSERT INTO PM_NODE_EDGE (PROJECT_ID, SOURCE_NODE_ID, TARGET_NODE_ID, LABEL) VALUES (1, 4, 5, NULL);

-- Model configs (Active) for LLM nodes
INSERT INTO PM_MODEL_CONFIG (NODE_ID, VERSION_NO, MODEL_PROVIDER, MODEL_NM, TEMPERATURE, MAX_TOKENS, IS_ACTIVE, CREATED_BY)
  VALUES (3, '1.0', 'anthropic', 'claude-sonnet-4-6', 0.3, 1024, 'Y', 'admin');
INSERT INTO PM_MODEL_CONFIG (NODE_ID, VERSION_NO, MODEL_PROVIDER, MODEL_NM, TEMPERATURE, MAX_TOKENS, IS_ACTIVE, CREATED_BY)
  VALUES (4, '1.0', 'anthropic', 'claude-sonnet-4-6', 0.5, 1024, 'Y', 'admin');
INSERT INTO PM_MODEL_CONFIG (NODE_ID, VERSION_NO, MODEL_PROVIDER, MODEL_NM, TEMPERATURE, MAX_TOKENS, IS_ACTIVE, CREATED_BY)
  VALUES (2, '1.0', 'anthropic', 'claude-haiku-4-5-20251001', 0.0, 256, 'Y', 'admin');

-- Prompt versions (Active)
INSERT INTO PM_PROMPT_VERSION (NODE_ID, CONFIG_ID, VERSION_NO, SYSTEM_PROMPT, USER_PROMPT, IS_ACTIVE, CHANGE_SUMMARY, CHANGE_REASON, CREATED_BY)
  VALUES (2, 3, '1.0.0',
    'You classify customer inquiries into IT or General.',
    'Inquiry: {{inquiry_text}}'||CHR(10)||'Reply with exactly one word: IT or General.',
    'Y', 'Initial version', 'Initial baseline', 'admin');

INSERT INTO PM_PROMPT_VERSION (NODE_ID, CONFIG_ID, VERSION_NO, SYSTEM_PROMPT, USER_PROMPT, IS_ACTIVE, CHANGE_SUMMARY, CHANGE_REASON, CREATED_BY)
  VALUES (3, 1, '1.0.0',
    'You are an IT support specialist. Provide accurate, concise help.',
    'User question: {{inquiry_text}}',
    'Y', 'Initial version', 'Initial baseline', 'admin');

INSERT INTO PM_PROMPT_VERSION (NODE_ID, CONFIG_ID, VERSION_NO, SYSTEM_PROMPT, USER_PROMPT, IS_ACTIVE, CHANGE_SUMMARY, CHANGE_REASON, CREATED_BY)
  VALUES (4, 2, '1.0.0',
    'You are a friendly customer support agent.',
    'Question: {{inquiry_text}}'||CHR(10)||'Customer name: {{customer_name}}',
    'Y', 'Initial version', 'Initial baseline', 'admin');

INSERT INTO PM_PROMPT_VARIABLE (PROMPT_ID, VAR_NAME, VAR_TYPE, DESCRIPTION, IS_REQUIRED) VALUES (1, 'inquiry_text', 'STRING', 'Raw inquiry from customer', 'Y');
INSERT INTO PM_PROMPT_VARIABLE (PROMPT_ID, VAR_NAME, VAR_TYPE, DESCRIPTION, IS_REQUIRED) VALUES (2, 'inquiry_text', 'STRING', 'Raw inquiry from customer', 'Y');
INSERT INTO PM_PROMPT_VARIABLE (PROMPT_ID, VAR_NAME, VAR_TYPE, DESCRIPTION, IS_REQUIRED) VALUES (3, 'inquiry_text', 'STRING', 'Raw inquiry from customer', 'Y');
INSERT INTO PM_PROMPT_VARIABLE (PROMPT_ID, VAR_NAME, VAR_TYPE, DESCRIPTION, IS_REQUIRED) VALUES (3, 'customer_name', 'STRING', 'Customer display name', 'N');

COMMIT;
