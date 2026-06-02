from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Oracle connection. On the internal network these arrive as three separate
    # values; oracle_dsn is the BARE connection string handed to python-oracledb
    # as `dsn` (Easy Connect "host:port/service", a tnsnames alias, or a full
    # "(DESCRIPTION=...)" descriptor) — credentials are NOT embedded in it.
    # Env: ORACLE_USER / ORACLE_PASSWORD / ORACLE_DSN.
    oracle_user: str = "pm_user"
    oracle_password: str = "pm_password"
    oracle_dsn: str = "localhost:1521/XEPDB1"
    test_database_url: str = "sqlite+pysqlite:///:memory:"

    cors_origins: str = "http://localhost:3000"
    log_level: str = "INFO"

    # RAGAS engine mode: "auto" (use real ragas when the lib + a provider key
    # are available, else fallback), "fallback" (always heuristic), "ragas"
    # (force real ragas). Env: RAGAS_ENGINE.
    ragas_engine: str = "auto"

    # External agent integration (flow-level RAGAS answer generation).
    # run_mode="external" routes answer generation to the real chat/super-agent
    # endpoint over HTTP; "stub" (default) returns a deterministic placeholder
    # answer in-process, so flow RAGAS runs end-to-end before the agent is wired.
    # Swap to external by setting RUN_MODE=external + EXTERNAL_AGENT_BASE_URL.
    # Env: RUN_MODE / EXTERNAL_AGENT_BASE_URL.
    run_mode: str = "stub"
    external_agent_base_url: str = ""
    # Path (appended to external_agent_base_url) of the internal model's single
    # chat/run endpoint used by the full/flow test. Env: EXTERNAL_CHAT_PATH.
    # >>> FILL IN: confirm the internal model's real path.
    external_chat_path: str = "/chat"
    # Static fields of the internal model's chat payload (see external_agent.run_flow).
    # The managed prompt rides in session_system_prompt; main_model_name comes from
    # the flow. Env: EXTERNAL_CHAT_TYPE / EXTERNAL_USER_ID / EXTERNAL_IS_SUPER_AGENT /
    # EXTERNAL_A2A_REMOTE_URLS.  >>> FILL IN to match the model's expectations.
    external_chat_type: str = "default"
    external_user_id: str = "pm-test"
    external_is_super_agent: bool | None = None
    external_a2a_remote_urls: str | None = None

    # Internal LLM gateway (OpenAI-compatible: base URL + key + model name).
    # The RAGAS judge LLM routes HERE — this is the only LLM this system calls.
    # Env: LLM_MODEL_NAME / LLM_ENDPOINT / LLM_API_KEY.
    llm_model_name: str = ""
    llm_endpoint: str = ""
    llm_api_key: str = ""

    # Embedding model name served by the same internal gateway (base_url=LLM_ENDPOINT).
    # Required for real RAGAS context metrics (precision/recall); LLM-only metrics
    # still run if it's unset. Env: OPENAI_EMBEDDING_MODEL.
    openai_embedding_model: str = ""

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def _is_test(self) -> bool:
        return os.getenv("APP_ENV") == "test"

    def sqlalchemy_url(self) -> str:
        """SQLAlchemy URL. TEST_DATABASE_URL when APP_ENV=test; otherwise a bare
        ``oracle+oracledb://`` URL — the real user/password/dsn are passed
        separately via ``oracle_connect_args()`` so any DSN form is preserved."""
        if self._is_test():
            return self.test_database_url
        return "oracle+oracledb://"

    def oracle_connect_args(self) -> dict[str, str]:
        """Connection kwargs handed straight to python-oracledb (user/password/dsn).
        Empty under APP_ENV=test (SQLite needs none)."""
        if self._is_test():
            return {}
        return {
            "user": self.oracle_user,
            "password": self.oracle_password,
            "dsn": self.oracle_dsn,
        }

    def internal_llm_enabled(self) -> bool:
        """True when an internal OpenAI-compatible LLM gateway is configured."""
        return bool(self.llm_endpoint.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
