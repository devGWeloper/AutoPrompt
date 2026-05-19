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

    # LLM provider API keys (read from .env / environment).
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""

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
