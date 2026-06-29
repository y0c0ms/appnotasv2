"""Application configuration via environment variables.

All settings are loaded from the environment (or a .env file) using
pydantic-settings. This is the single source of truth for configuration —
nowhere else in the codebase should ``os.environ`` be called directly.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _get_default_version() -> str:
    """Load the app version from the top entry of CHANGELOG.md."""
    try:
        from app.services.changelog import parse_latest_version, read_changelog

        return parse_latest_version(read_changelog())
    except Exception:
        return "0.0.0"


class Settings(BaseSettings):
    app_name: str = "appnotas-mcp"
    app_version: str = Field(default_factory=_get_default_version)
    environment: str = Field(default="local")
    log_level: str = Field(default="INFO")
    host: str = "0.0.0.0"
    port: int = 8000

    # --- HTTP authentication (Bearer token) ---
    auth_enabled: bool = False
    api_token: SecretStr = Field(default=SecretStr(""))

    # --- MCP transport security (DNS-rebinding protection) ---
    allowed_hosts: str = Field(default="")
    allowed_origins: str = Field(default="")

    # --- HTTP request limits (HTTP transport only; N/A to stdio) ---
    rate_limit_enabled: bool = False
    rate_limit_requests: int = 60
    rate_limit_window_seconds: float = 60.0
    max_body_bytes: int = 1_048_576  # 1 MiB

    # --- Reverse-proxy / path-prefix support ---
    base_path: str = ""
    root_path: str = ""

    # --- AppNotas (local notes folder) ---
    # Absolute path to the notes directory. If empty, the server auto-discovers
    # it from the AppNotas settings file
    # (%APPDATA%/com.appnotas.desktop/appnotas-settings.json -> notesDirectory).
    # Point this at a throwaway folder for development.
    notes_dir: str = Field(default="")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def check_auth_config(self) -> Self:
        if self.auth_enabled and not self.api_token.get_secret_value():
            raise ValueError("API_TOKEN must be set when AUTH_ENABLED=true")
        return self

    @model_validator(mode="after")
    def normalize_proxy_paths(self) -> Self:
        self.base_path = self._norm_path(self.base_path)
        self.root_path = self._norm_path(self.root_path)
        return self

    @staticmethod
    def _norm_path(value: str) -> str:
        v = value.strip()
        if v and not v.startswith("/"):
            v = "/" + v
        return v.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
