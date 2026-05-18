# database.py - SQLAlchemy database setup and session management
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, Session, DeclarativeBase
from config import settings
import logging

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models"""
    pass


engine_kwargs = {
    "echo": False,
    "future": True,
}

if settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

try:
    engine = create_engine(settings.DATABASE_URL, **engine_kwargs)
    logger.info("Database engine created successfully")
except Exception as e:
    logger.error(f"Failed to create database engine: {e}")
    raise


@event.listens_for(engine, "connect")
def receive_connect(dbapi_conn, connection_record):
    """Configure database connection settings on connection."""
    if engine.dialect.name == "mssql":
        try:
            cursor = dbapi_conn.cursor()
            cursor.execute("SET DATEFIRST 1")  # Set week to start on Monday
            cursor.close()
        except Exception as e:
            logger.warning(f"Failed to set DATEFIRST: {e}")
    elif engine.dialect.name == "sqlite":
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)


def get_db() -> Session:
    """
    Dependency for FastAPI to provide database sessions.
    Usage: def my_endpoint(db: Session = Depends(get_db))
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Initialize database tables.
    Call this once during application startup.
    """
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "mssql":
        migrate_user_auth_columns()
        migrate_auth_session_columns()
    migrate_concrete_requisition_columns()
    migrate_production_dispatch_columns()
    seed_requisition_elements_if_empty()
    seed_supply_sequences_from_existing_requisitions()
    logger.info("Database tables initialized")


def seed_requisition_elements_if_empty():
    """Populate master reference lookup rows once when the table is empty."""
    try:
        from models import RequisitionElement
        from seed import seed_reference_data

        with SessionLocal() as db:
            has_rows = db.query(RequisitionElement.id).first() is not None
            if not has_rows:
                seed_reference_data(db=db, clear_existing=True)
    except Exception as e:
        logger.warning(f"Reference data seed skipped or failed: {e}")


def seed_supply_sequences_from_existing_requisitions():
    """Bootstrap supply sequence rows from legacy requisition IDs once."""
    try:
        from models import ConcreteRequisition, SupplySequence

        with SessionLocal() as db:
            existing_sequences = {
                base_code for (base_code,) in db.query(SupplySequence.base_code).all()
            }
            highest_by_base: dict[str, int] = {}
            for (supply_id,) in db.query(ConcreteRequisition.supply_id).all():
                base, _, suffix = supply_id.rpartition("-")
                if not base or not suffix.isdigit() or base in existing_sequences:
                    continue
                highest_by_base[base] = max(highest_by_base.get(base, 0), int(suffix))

            for base_code, current_sequence in highest_by_base.items():
                db.add(SupplySequence(base_code=base_code, current_sequence=current_sequence))

            if highest_by_base:
                db.commit()
                logger.info(f"Seeded {len(highest_by_base)} supply sequence rows from existing requisitions")
    except Exception as e:
        logger.warning(f"Supply sequence bootstrap skipped or failed: {e}")


def migrate_concrete_requisition_columns():
    """Add newer requisition slip columns to existing development databases."""
    columns = [
        ("rfi_no", "VARCHAR(100)", "VARCHAR(100)"),
        ("requisition_date", "VARCHAR(20)", "VARCHAR(20)"),
        ("structure_type", "VARCHAR(100)", "VARCHAR(100)"),
        ("pile_lift_id", "VARCHAR(100)", "VARCHAR(100)"),
        ("drawing_no", "VARCHAR(255)", "VARCHAR(255)"),
        ("drawing_length", "FLOAT", "FLOAT"),
        ("drawing_diameter", "FLOAT", "FLOAT"),
        ("theoretical_qty", "FLOAT", "FLOAT"),
        ("actual_length", "FLOAT", "FLOAT"),
        ("actual_diameter", "FLOAT", "FLOAT"),
        ("actual_qty", "FLOAT", "FLOAT"),
        ("qty_difference", "FLOAT", "FLOAT"),
        ("difference_reason", "VARCHAR(500)", "VARCHAR(500)"),
        ("pour_time", "VARCHAR(20)", "VARCHAR(20)"),
        ("contact_person", "VARCHAR(255)", "VARCHAR(255)"),
        ("contact_number", "VARCHAR(50)", "VARCHAR(50)"),
    ]

    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
            for column_name, mssql_type, _ in columns:
                conn.execute(text(f"""
                IF COL_LENGTH('concrete_requisitions', '{column_name}') IS NULL
                ALTER TABLE concrete_requisitions ADD {column_name} {mssql_type} NULL
                """))
        elif engine.dialect.name == "sqlite":
            existing_columns = {
                row[1] for row in conn.execute(text("PRAGMA table_info(concrete_requisitions)"))
            }
            for column_name, _, sqlite_type in columns:
                if column_name not in existing_columns:
                    conn.execute(text(
                        f"ALTER TABLE concrete_requisitions ADD COLUMN {column_name} {sqlite_type}"
                    ))


def migrate_production_dispatch_columns():
    """Add dispatch acknowledgement columns to existing development databases."""
    columns = [
        ("batching_plant_id", "VARCHAR(100)", "VARCHAR(100)"),
        ("receipt_location", "VARCHAR(500)", "VARCHAR(500)"),
        ("receipt_at_site_time", "DATETIME", "DATETIME"),
        ("release_from_site_time", "DATETIME", "DATETIME"),
        ("return_to_plant_time", "DATETIME", "DATETIME"),
        ("remarks", "VARCHAR(2000)", "VARCHAR(2000)"),
    ]

    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
            for column_name, mssql_type, _ in columns:
                conn.execute(text(f"""
                IF COL_LENGTH('production_dispatch', '{column_name}') IS NULL
                ALTER TABLE production_dispatch ADD {column_name} {mssql_type} NULL
                """))
        elif engine.dialect.name == "sqlite":
            existing_columns = {
                row[1] for row in conn.execute(text("PRAGMA table_info(production_dispatch)"))
            }
            for column_name, _, sqlite_type in columns:
                if column_name not in existing_columns:
                    conn.execute(text(
                        f"ALTER TABLE production_dispatch ADD COLUMN {column_name} {sqlite_type}"
                    ))


def migrate_user_auth_columns():
    """Add auth columns to existing development databases."""
    statements = [
        """
        IF COL_LENGTH('users', 'password_hash') IS NULL
        ALTER TABLE users ADD password_hash VARCHAR(255) NULL
        """,
        """
        IF COL_LENGTH('users', 'is_email_verified') IS NULL
        ALTER TABLE users ADD is_email_verified BIT NOT NULL CONSTRAINT DF_users_is_email_verified DEFAULT 1
        """,
        """
        IF COL_LENGTH('users', 'last_login_at') IS NULL
        ALTER TABLE users ADD last_login_at DATETIME NULL
        """,
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def migrate_auth_session_columns():
    """Repair existing development auth_sessions tables created by older drafts."""
    statements = [
        """
        IF OBJECT_ID('auth_sessions', 'U') IS NULL
        CREATE TABLE auth_sessions (
            session_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
            user_id UNIQUEIDENTIFIER NOT NULL,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL CONSTRAINT DF_auth_sessions_created_at DEFAULT GETDATE(),
            revoked_at DATETIME NULL,
            CONSTRAINT FK_auth_sessions_users FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """,
        """
        IF COL_LENGTH('auth_sessions', 'revoked_at') IS NULL
        ALTER TABLE auth_sessions ADD revoked_at DATETIME NULL
        """,
        """
        IF COL_LENGTH('auth_sessions', 'created_at') IS NULL
        ALTER TABLE auth_sessions ADD created_at DATETIME NOT NULL CONSTRAINT DF_auth_sessions_created_at DEFAULT GETDATE()
        """,
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_auth_sessions_token_hash'
              AND object_id = OBJECT_ID('auth_sessions')
        )
        CREATE INDEX IX_auth_sessions_token_hash ON auth_sessions(token_hash)
        """,
        """
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_auth_sessions_user_id'
              AND object_id = OBJECT_ID('auth_sessions')
        )
        CREATE INDEX IX_auth_sessions_user_id ON auth_sessions(user_id)
        """,
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
