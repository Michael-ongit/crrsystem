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
    migrate_user_auth_columns()
    migrate_auth_session_columns()
    migrate_registration_invite_location_columns()
    migrate_concrete_requisition_columns()
    migrate_production_dispatch_columns()
    migrate_dispatch_receipt_allocations()
    seed_dropdown_options_if_empty()
    seed_requisition_elements_if_empty()
    seed_supply_sequences_from_existing_requisitions()
    seed_sample_data_if_empty()
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


def seed_dropdown_options_if_empty():
    """Populate admin-managed dropdown lists with current application defaults."""
    try:
        from models import DropdownOption

        defaults = {
            "concrete_grade": ["M-10", "M-20", "M-25", "M-30", "M-45", "M-45P", "M-50", "M-55", "M-60"],
            "placement_by": ["Boom Placer", "Direct - Chute"],
            "vehicle_number": ["TM-001", "TM-002", "TM-003"],
            "difference_reason": ["Site measurement variation", "Drawing revision", "Pour sequence adjustment"],
        }

        with SessionLocal() as db:
            for category, values in defaults.items():
                has_category = (
                    db.query(DropdownOption.option_id)
                    .filter(DropdownOption.category == category)
                    .first()
                    is not None
                )
                if has_category:
                    continue
                for index, value in enumerate(values, start=1):
                    db.add(
                        DropdownOption(
                            category=category,
                            value=value,
                            label=value,
                            sort_order=index,
                            is_active=True,
                        )
                    )
            db.commit()
    except Exception as e:
        logger.warning(f"Dropdown option seed skipped or failed: {e}")


def seed_sample_data_if_empty():
    """Populate a fresh development database with realistic workflow examples."""
    if not settings.SEED_SAMPLE_DATA:
        return

    try:
        from models import ConcreteRequisition
        from seed import seed_sample_data

        with SessionLocal() as db:
            has_demo_orders = (
                db.query(ConcreteRequisition.supply_id)
                .filter(ConcreteRequisition.supply_id.like("MVDP-DEMO-%"))
                .first()
                is not None
            )
            if not has_demo_orders:
                created = seed_sample_data(db=db)
                logger.info(f"Seeded {created} sample requisitions")
    except Exception as e:
        logger.warning(f"Sample data seed skipped or failed: {e}")


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
        ("in_charge_name", "VARCHAR(255)", "VARCHAR(255)"),
        ("selected_in_charge", "VARCHAR(255)", "VARCHAR(255)"),
        ("placed_by_id", "VARCHAR(36)", "VARCHAR(36)"),
        ("placed_by_name", "VARCHAR(255)", "VARCHAR(255)"),
        ("placed_by_email", "VARCHAR(255)", "VARCHAR(255)"),
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
        ("returned_wastage_qty", "FLOAT NOT NULL DEFAULT 0", "FLOAT NOT NULL DEFAULT 0"),
        ("remaining_concrete_disposition", "VARCHAR(50)", "VARCHAR(50)"),
        ("pending_secondary_qty", "FLOAT NOT NULL DEFAULT 0", "FLOAT NOT NULL DEFAULT 0"),
        ("pending_secondary_receipt_location", "VARCHAR(500)", "VARCHAR(500)"),
        ("pending_secondary_receipt_structure_name", "VARCHAR(255)", "VARCHAR(255)"),
        ("pending_secondary_receipt_structure_id", "VARCHAR(50)", "VARCHAR(50)"),
    ]

    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
            for column_name, mssql_type, _ in columns:
                null_suffix = "" if "NOT NULL" in mssql_type.upper() else " NULL"
                conn.execute(text(f"""
                IF COL_LENGTH('production_dispatch', '{column_name}') IS NULL
                ALTER TABLE production_dispatch ADD {column_name} {mssql_type}{null_suffix}
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


def migrate_dispatch_receipt_allocations():
    """Create receipt allocation rows for partial concrete deposits."""
    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
            conn.execute(text("""
            IF OBJECT_ID('dispatch_receipt_allocations', 'U') IS NULL
            CREATE TABLE dispatch_receipt_allocations (
                allocation_id VARCHAR(36) NOT NULL PRIMARY KEY,
                dispatch_id VARCHAR(36) NOT NULL,
                deposited_qty FLOAT NOT NULL,
                receipt_location VARCHAR(500) NOT NULL,
                receipt_structure_name VARCHAR(255) NOT NULL,
                receipt_structure_id VARCHAR(50) NOT NULL,
                receipt_at_site_time DATETIME NOT NULL,
                release_from_site_time DATETIME NOT NULL,
                remarks VARCHAR(2000) NULL,
                created_at DATETIME NOT NULL CONSTRAINT DF_dispatch_receipt_allocations_created_at DEFAULT GETDATE(),
                updated_at DATETIME NOT NULL CONSTRAINT DF_dispatch_receipt_allocations_updated_at DEFAULT GETDATE(),
                CONSTRAINT FK_dispatch_receipt_allocations_dispatch
                    FOREIGN KEY (dispatch_id) REFERENCES production_dispatch(dispatch_id)
            )
            """))
            conn.execute(text("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'IX_dispatch_receipt_allocations_dispatch_id'
                  AND object_id = OBJECT_ID('dispatch_receipt_allocations')
            )
            CREATE INDEX IX_dispatch_receipt_allocations_dispatch_id
            ON dispatch_receipt_allocations(dispatch_id)
            """))
        elif engine.dialect.name == "sqlite":
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dispatch_receipt_allocations (
                allocation_id VARCHAR(36) NOT NULL PRIMARY KEY,
                dispatch_id VARCHAR(36) NOT NULL,
                deposited_qty FLOAT NOT NULL,
                receipt_location VARCHAR(500) NOT NULL,
                receipt_structure_name VARCHAR(255) NOT NULL,
                receipt_structure_id VARCHAR(50) NOT NULL,
                receipt_at_site_time DATETIME NOT NULL,
                release_from_site_time DATETIME NOT NULL,
                remarks VARCHAR(2000),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(dispatch_id) REFERENCES production_dispatch(dispatch_id)
            )
            """))
            conn.execute(text("""
            CREATE INDEX IF NOT EXISTS IX_dispatch_receipt_allocations_dispatch_id
            ON dispatch_receipt_allocations(dispatch_id)
            """))


def migrate_user_auth_columns():
    """Add auth columns to existing development databases."""
    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
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
                """
                IF COL_LENGTH('users', 'assigned_locations') IS NULL
                ALTER TABLE users ADD assigned_locations VARCHAR(2000) NULL
                """,
            ]
            for statement in statements:
                conn.execute(text(statement))
        elif engine.dialect.name == "sqlite":
            existing_columns = {
                row[1] for row in conn.execute(text("PRAGMA table_info(users)"))
            }
            sqlite_columns = [
                ("password_hash", "VARCHAR(255)"),
                ("is_email_verified", "BOOLEAN NOT NULL DEFAULT 1"),
                ("last_login_at", "DATETIME"),
                ("assigned_locations", "VARCHAR(2000)"),
            ]
            for column_name, sqlite_type in sqlite_columns:
                if column_name not in existing_columns:
                    conn.execute(text(
                        f"ALTER TABLE users ADD COLUMN {column_name} {sqlite_type}"
                    ))


def migrate_auth_session_columns():
    """Repair existing development auth_sessions tables created by older drafts."""
    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
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
            for statement in statements:
                conn.execute(text(statement))
        elif engine.dialect.name == "sqlite":
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                session_id VARCHAR(36) NOT NULL PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                revoked_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """))
            existing_columns = {
                row[1] for row in conn.execute(text("PRAGMA table_info(auth_sessions)"))
            }
            if "revoked_at" not in existing_columns:
                conn.execute(text("ALTER TABLE auth_sessions ADD COLUMN revoked_at DATETIME"))
            if "created_at" not in existing_columns:
                conn.execute(text("ALTER TABLE auth_sessions ADD COLUMN created_at DATETIME"))
                conn.execute(text("UPDATE auth_sessions SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"))
            conn.execute(text("""
            CREATE INDEX IF NOT EXISTS IX_auth_sessions_token_hash
            ON auth_sessions(token_hash)
            """))
            conn.execute(text("""
            CREATE INDEX IF NOT EXISTS IX_auth_sessions_user_id
            ON auth_sessions(user_id)
            """))

def migrate_registration_invite_location_columns():
    """Add location assignment support for approved registration emails."""
    with engine.begin() as conn:
        if engine.dialect.name == "mssql":
            conn.execute(text("""
            IF COL_LENGTH('registration_invites', 'assigned_locations') IS NULL
            ALTER TABLE registration_invites ADD assigned_locations VARCHAR(2000) NULL
            """))
        elif engine.dialect.name == "sqlite":
            existing_columns = {
                row[1] for row in conn.execute(text("PRAGMA table_info(registration_invites)"))
            }
            if "assigned_locations" not in existing_columns:
                conn.execute(text(
                    "ALTER TABLE registration_invites ADD COLUMN assigned_locations VARCHAR(2000)"
                ))
