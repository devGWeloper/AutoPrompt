from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Oracle connection. On the internal network these arrive as three separate
    # values; oracle_dsn is the BARE connection string handed to python-oracledb
    # as `dsn` — Easy Connect "host:port/service", a tnsnames alias, or a full
    # "(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...)))
    # (CONNECT_DATA=(SERVICE_NAME=...)))" descriptor. Credentials are NOT embedded.
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
    # The chat request body carries {message, user_id}; auth + user identity also
    # go in HTTP headers (header names are configurable to match the external
    # API spec). Empty header value → that header is omitted.
    # Env: RUN_MODE / EXTERNAL_AGENT_BASE_URL / EXTERNAL_CHAT_PATH
    #    / EXTERNAL_AUTH_HEADER / EXTERNAL_AUTH_KEY
    #    / EXTERNAL_USER_HEADER / EXTERNAL_USER_ID.
    run_mode: str = "stub"
    external_agent_base_url: str = ""
    external_chat_path: str = "/chat"
    external_auth_header: str = "Authorization"
    external_auth_key: str = ""
    external_user_header: str = "user-id"
    external_user_id: str = "pm-test"

    # Internal LLM gateway (OpenAI-compatible: base URL + key + model name).
    # The RAGAS judge LLM routes HERE — this is the only LLM this system calls.
    # Env: LLM_MODEL_NAME / LLM_ENDPOINT / LLM_API_KEY.
    llm_model_name: str = ""
    llm_endpoint: str = ""
    llm_api_key: str = ""

    # Embedding model (OpenAI-compatible: base URL + key + model name). MAY point
    # at a different gateway than LLM_*. Required for RAGAS context metrics
    # (context_precision / context_recall); LLM-only metrics still run if
    # embedding_endpoint is unset.
    # Env: EMBEDDING_MODEL_NAME / EMBEDDING_ENDPOINT / EMBEDDING_API_KEY.
    embedding_model_name: str = ""
    embedding_endpoint: str = ""
    embedding_api_key: str = ""

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
