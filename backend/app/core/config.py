from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    oracle_dsn: str = "pm_user/pm_password@localhost:1521/XEPDB1"
    test_database_url: str = "sqlite+pysqlite:///:memory:"

    cors_origins: str = "http://localhost:3000"
    log_level: str = "INFO"

    # RAGAS engine mode: "auto" (use real ragas when the lib + a provider key
    # are available, else fallback), "fallback" (always heuristic), "ragas"
    # (force real ragas). Env: RAGAS_ENGINE.
    ragas_engine: str = "auto"

    # External agent integration. run_mode="internal" (default) runs flow/test
    # nodes with this system's own LLM adapters; "external" routes node
    # execution / RAG retrieval to a real LangGraph service over HTTP.
    # Env: RUN_MODE / EXTERNAL_AGENT_BASE_URL.
    run_mode: str = "internal"
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

    # LLM provider API keys (read from .env / environment).
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""

    # RAGAS real-engine judge chat models, per provider (no default — used when
    # a run doesn't pin judge_model; if both are unset the run fails per-case
    # with a clear error). Env: GOOGLE_JUDGE_MODEL / OPENAI_JUDGE_MODEL /
    # ANTHROPIC_JUDGE_MODEL.
    google_judge_model: str = ""
    openai_judge_model: str = ""
    anthropic_judge_model: str = ""

    # RAGAS real-engine embedding models (no default — must be set in .env when
    # the real engine is used, else the run fails per-case with a clear error).
    # Env: GOOGLE_EMBEDDING_MODEL / OPENAI_EMBEDDING_MODEL.
    google_embedding_model: str = ""
    openai_embedding_model: str = ""

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def sqlalchemy_url(self) -> str:
        """Build SQLAlchemy URL. Honors TEST_DATABASE_URL when APP_ENV=test."""
        if os.getenv("APP_ENV") == "test":
            return self.test_database_url
        # python-oracledb thin URL format: oracle+oracledb://user:password@host:port/?service_name=SERVICE
        # Accept either a SQLAlchemy URL or a tnsnames-style DSN "user/pw@host:port/SERVICE".
        dsn = self.oracle_dsn
        if dsn.startswith("oracle+"):
            return dsn
        # Parse "user/password@host:port/SERVICE"
        try:
            creds, target = dsn.split("@", 1)
            user, password = creds.split("/", 1)
            host_port, service = target.rsplit("/", 1)
            if ":" in host_port:
                host, port = host_port.split(":", 1)
            else:
                host, port = host_port, "1521"
            return f"oracle+oracledb://{user}:{password}@{host}:{port}/?service_name={service}"
        except ValueError:
            return dsn  # let SQLAlchemy raise


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
