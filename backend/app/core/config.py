from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os


INSECURE_SECRET_KEYS = {"changethis", "secret", "change-me", "insecure", ""}


class Settings(BaseSettings):
    PROJECT_NAME: str = "Sthenova ERP"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"  # "production" en Render; activa las validaciones de arranque
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

    # Almacenamiento de archivos (documentos de proveedores, imágenes, etc.)
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_KEY: str | None = None
    SUPABASE_BUCKET: str = "sthenova-files"

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

        if self.ENVIRONMENT == "production":
            self._validate_production_config()

    def _validate_production_config(self) -> None:
        """Falla el arranque (no solo advierte) si producción quedaría insegura."""
        errors = []
        if self.SECRET_KEY.strip().lower() in INSECURE_SECRET_KEYS or len(self.SECRET_KEY) < 32:
            errors.append(
                "SECRET_KEY no está configurada o es insegura (mínimo 32 caracteres, "
                "no puede ser el valor por defecto). Define la variable de entorno SECRET_KEY "
                "en Render con una cadena aleatoria fuerte."
            )
        if self.SQLALCHEMY_DATABASE_URI and self.SQLALCHEMY_DATABASE_URI.startswith("sqlite"):
            errors.append(
                "ENVIRONMENT=production pero no hay DATABASE_URL configurada: se usaría SQLite "
                "local, que no es apta para producción."
            )
        if errors:
            raise RuntimeError(
                "Configuración insegura para ENVIRONMENT=production:\n- " + "\n- ".join(errors)
            )


settings = Settings()
