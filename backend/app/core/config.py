from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os


class Settings(BaseSettings):
    PROJECT_NAME: str = "Sthenova ERP"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changethis"  # Overridden by the SECRET_KEY env var in production
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days

    # Database
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "password"
    POSTGRES_DB: str = "sthenova"
    SQLALCHEMY_DATABASE_URI: str | None = None

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env")

    def __init__(self, **data):
        super().__init__(**data)
        if not self.SQLALCHEMY_DATABASE_URI:
            db_url = os.getenv("DATABASE_URL")
            if db_url:
                # Normalize a provider URL (Render / Heroku) to the async driver
                if db_url.startswith("postgres://"):
                    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
                elif db_url.startswith("postgresql://"):
                    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
                # asyncpg does not accept libpq-style sslmode params
                db_url = db_url.replace("?sslmode=require", "").replace("&sslmode=require", "")
                self.SQLALCHEMY_DATABASE_URI = db_url
            else:
                # Local development fallback: SQLite
                base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                db_path = os.path.join(base_dir, "sthenova.db")
                self.SQLALCHEMY_DATABASE_URI = f"sqlite+aiosqlite:///{db_path}"


settings = Settings()
