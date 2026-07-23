"""Application settings, loaded from environment variables (or a local .env file).

Pydantic-settings reads each field below from an env var of the same name
(case-insensitive), so `DATABASE_URL` in .env becomes `settings.database_url` here.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./ludo_dev.db"
    jwt_secret: str = "dev-only-insecure-secret"
    admin_username: str = "admin"
    admin_temp_password: str = "change-me-on-first-login"
    cookie_secure: bool = False
    # Registers the /debug testing routes (routes/debug.py). Local dev only —
    # never set this on Render.
    debug_tools: bool = False

    # How long a login stays valid before the user must log in again.
    jwt_expiry_days: int = 30


settings = Settings()
