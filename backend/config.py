# config.py - Configuration settings for the MVDP System
import os
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application configuration using environment variables.
    Ensure to set these in a .env file or system environment:
    DATABASE_URL, API_CORS_ORIGIN
    """
    # Database Configuration
    # Local development defaults to SQLite to avoid SQL Server/ODBC setup issues.
    DATABASE_BACKEND: str = "sqlite"
    SQLITE_DATABASE_PATH: str = "mvdp_dev.db"
    DATABASE_DRIVER: str = "ODBC Driver 17 for SQL Server"
    DATABASE_SERVER: str = "localhost\\SQLEXPRESS"
    DATABASE_NAME: str = "MVDP_DB"
    DATABASE_USER: str = "SQLuser1"
    DATABASE_PASSWORD: str = "SQLuser1"
    
    # Computed connection string for pyodbc
    @property
    def DATABASE_URL(self) -> str:
        """Return the active SQLAlchemy database URL."""
        if self.DATABASE_BACKEND.lower() != "mssql":
            db_path = Path(self.SQLITE_DATABASE_PATH)
            if not db_path.is_absolute():
                db_path = Path(__file__).resolve().parent / db_path
            db_path.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{db_path.as_posix()}"

        from sqlalchemy.engine import URL

        return str(
            URL.create(
                "mssql+pyodbc",
                username=self.DATABASE_USER,
                password=self.DATABASE_PASSWORD,
                host=self.DATABASE_SERVER,
                database=self.DATABASE_NAME,
                query={
                    "driver": self.DATABASE_DRIVER,
                    "TrustServerCertificate": "yes",
                    "Encrypt": "no",
                },
            )
        )
    
    # CORS Configuration
    CORS_ORIGINS: list = [
        "http://localhost:5090",
        "http://127.0.0.1:5090",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:3000",
    ]
    
    # API Configuration
    API_TITLE: str = "Concrete Requisition & Reconciliation System"
    API_VERSION: str = "1.0.0"
    AUTH_SESSION_DAYS: int = 7
    SEED_SAMPLE_DATA: bool = True

    # Email notifications. When disabled or SMTP host is empty, notifications
    # are written to the backend log instead of being sent.
    EMAIL_ENABLED: bool = False
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    MAIL_FROM: str = "no-reply@mvdp.local"
    
    # Business Rules
    ACE_LIMIT_PERCENT: float = 1.0  # Maximum allowed wastage percentage
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
if settings.API_TITLE == "MVDP Concrete Reconciliation System":
    settings.API_TITLE = "Concrete Requisition & Reconciliation System"
