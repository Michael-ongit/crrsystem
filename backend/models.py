# models.py - SQLAlchemy ORM models for MVDP System
from sqlalchemy import Boolean, Column, String, DateTime, Float, Enum, ForeignKey, Index, Integer
from sqlalchemy.orm import relationship
from database import Base
from time_utils import now_ist
from enum import Enum as PyEnum
import uuid


UUID_COLUMN = String(36)


def enum_values(enum_class):
    return [member.value for member in enum_class]


class UserRole(str, PyEnum):
    """Enumeration for user roles in the system"""
    EXECUTION = "Execution"
    PLANNING = "Planning"
    PRODUCTION = "Production"
    ADMIN = "Admin"


class RequisitionStatus(str, PyEnum):
    """Enumeration for concrete requisition workflow status"""
    PENDING = "Pending"
    VALIDATED = "Validated"
    DISPATCHED = "Dispatched"
    RETURNING = "Returning"
    RECONCILED = "Reconciled"


class User(Base):
    """
    User model representing system users.
    Stores user identity and role information for access control.
    """
    __tablename__ = "users"
    
    id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    role = Column(
        Enum(UserRole, values_callable=enum_values, native_enum=False),
        nullable=False,
        default=UserRole.EXECUTION,
    )
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=True)
    is_email_verified = Column(Boolean, nullable=False, default=False)
    assigned_locations_raw = Column("assigned_locations", String(2000), nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    
    # Relationships
    requisitions = relationship(
        "ConcreteRequisition",
        back_populates="in_charge",
        foreign_keys="ConcreteRequisition.in_charge_id",
    )
    validations = relationship("PlanningValidation", back_populates="validator")
    sessions = relationship("AuthSession", back_populates="user")

    @property
    def assigned_locations(self) -> list[str]:
        if not self.assigned_locations_raw:
            return []
        return [
            location.strip()
            for location in self.assigned_locations_raw.split(",")
            if location.strip()
        ]

    @assigned_locations.setter
    def assigned_locations(self, locations: list[str] | None) -> None:
        normalized = []
        for location in locations or []:
            location = location.strip()
            if location and location.lower() not in {item.lower() for item in normalized}:
                normalized.append(location)
        self.assigned_locations_raw = ",".join(normalized) if normalized else None
    
    def __repr__(self):
        return f"<User(id={self.id}, name={self.name}, role={self.role})>"


class AuthSession(Base):
    """Bearer session token for authenticated users"""
    __tablename__ = "auth_sessions"

    session_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(UUID_COLUMN, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="sessions")


class RegistrationInvite(Base):
    """Admin-approved email address that may self-register with an assigned role."""
    __tablename__ = "registration_invites"

    invite_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    name_hint = Column(String(255), nullable=True)
    role = Column(
        Enum(UserRole, values_callable=enum_values, native_enum=False),
        nullable=False,
        default=UserRole.EXECUTION,
    )
    assigned_locations_raw = Column("assigned_locations", String(2000), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    registered_user_id = Column(UUID_COLUMN, ForeignKey("users.id"), nullable=True)
    registered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    updated_at = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)

    @property
    def assigned_locations(self) -> list[str]:
        if not self.assigned_locations_raw:
            return []
        return [
            location.strip()
            for location in self.assigned_locations_raw.split(",")
            if location.strip()
        ]

    @assigned_locations.setter
    def assigned_locations(self, locations: list[str] | None) -> None:
        normalized = []
        for location in locations or []:
            location = location.strip()
            if location and location.lower() not in {item.lower() for item in normalized}:
                normalized.append(location)
        self.assigned_locations_raw = ",".join(normalized) if normalized else None


class DropdownOption(Base):
    """Admin-managed option list for user-facing dropdown fields."""
    __tablename__ = "dropdown_options"

    option_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    category = Column(String(100), nullable=False, index=True)
    value = Column(String(255), nullable=False)
    label = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    updated_at = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)


class RequisitionElement(Base):
    """
    Master reference row for concrete requisition structural hierarchy.

    Each record represents one valid Location -> Structure Type -> Structure Name
    -> Structure ID -> Element ID path sourced from the project requisition slip.
    The frontend uses this table through metadata endpoints to build dynamic,
    searchable cascading dropdowns without hardcoding site reference data.
    """
    __tablename__ = "requisition_elements"
    __table_args__ = (
        Index("idx_location_type", "location", "structure_type"),
        Index("idx_type_name", "location", "structure_type", "structure_name"),
    )

    id = Column(Integer, primary_key=True)
    location = Column(String(100), nullable=False)
    structure_type = Column(String(100), nullable=False)
    structure_name = Column(String(100), nullable=False)
    structure_id = Column(String(100), nullable=False)
    element_id = Column(String(100), nullable=True)

    def __repr__(self):
        return (
            "<RequisitionElement("
            f"location={self.location}, type={self.structure_type}, "
            f"name={self.structure_name}, structure_id={self.structure_id}, "
            f"element_id={self.element_id})>"
        )


class SupplySequence(Base):
    """
    Atomic supply ID sequence tracker keyed by immutable generated base code.

    This table replaces ad-hoc LIKE scans of existing requisitions. A row is
    locked and incremented for each new requisition sharing the same
    MVDP-{site}-{structure}-{structure_id}-{YYMMDD} base signature.
    """
    __tablename__ = "supply_sequences"

    base_code = Column(String(150), primary_key=True)
    current_sequence = Column(Integer, nullable=False, default=0)

    def __repr__(self):
        return f"<SupplySequence(base_code={self.base_code}, current_sequence={self.current_sequence})>"


class ConcreteRequisition(Base):
    """
    Core model for concrete supply requisitions.
    Tracks the complete lifecycle of a concrete order from request to reconciliation.
    
    Business Rule: SupplyID uniquely identifies each requisition.
    Format: MVDP-{site}-{structure}-{structure_id}-{YYMMDD}-{sequence}
    """
    __tablename__ = "concrete_requisitions"
    
    supply_id = Column(String(50), primary_key=True, index=True)
    req_date = Column(DateTime, nullable=False, default=now_ist)
    location = Column(String(500), nullable=False)
    in_charge_id = Column(UUID_COLUMN, ForeignKey("users.id"), nullable=False)
    in_charge_name = Column(String(255), nullable=True)
    selected_in_charge = Column(String(255), nullable=True)
    placed_by_id = Column(UUID_COLUMN, ForeignKey("users.id"), nullable=True, index=True)
    placed_by_name = Column(String(255), nullable=True)
    placed_by_email = Column(String(255), nullable=True)
    structure_name = Column(String(255), nullable=False)
    structure_id = Column(String(50), nullable=False, index=True)
    rfi_no = Column(String(100), nullable=True)
    requisition_date = Column(String(20), nullable=True)
    structure_type = Column(String(100), nullable=True)
    pile_lift_id = Column(String(100), nullable=True)
    grade = Column(String(50), nullable=False)  # e.g., M40, M50
    drawing_no = Column(String(255), nullable=True)
    drawing_length = Column(Float, nullable=True)
    drawing_diameter = Column(Float, nullable=True)
    theoretical_qty = Column(Float, nullable=True)
    actual_length = Column(Float, nullable=True)
    actual_diameter = Column(Float, nullable=True)
    actual_qty = Column(Float, nullable=True)
    qty_difference = Column(Float, nullable=True)
    difference_reason = Column(String(500), nullable=True)
    requested_qty = Column(Float, nullable=False)  # Cubic meters
    pour_time = Column(String(20), nullable=True)
    placement_by = Column(String(255), nullable=True)
    contact_person = Column(String(255), nullable=True)
    contact_number = Column(String(50), nullable=True)
    status = Column(
        Enum(RequisitionStatus, values_callable=enum_values, native_enum=False),
        nullable=False,
        default=RequisitionStatus.PENDING,
    )
    created_at = Column(DateTime, nullable=False, default=now_ist)
    updated_at = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)
    
    # Relationships
    in_charge = relationship(
        "User",
        back_populates="requisitions",
        foreign_keys=[in_charge_id],
    )
    placed_by = relationship("User", foreign_keys=[placed_by_id])
    planning_validation = relationship("PlanningValidation", back_populates="requisition", uselist=False)
    dispatch_logs = relationship("ProductionDispatch", back_populates="requisition")
    
    def __repr__(self):
        return f"<ConcreteRequisition(supply_id={self.supply_id}, qty={self.requested_qty}, status={self.status})>"


class PlanningValidation(Base):
    """
    Planning validation record.
    Captures approval/rejection decisions and remarks from Planning team.
    Links to ConcreteRequisition via foreign key.
    """
    __tablename__ = "planning_validations"
    
    validation_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    supply_id = Column(String(50), ForeignKey("concrete_requisitions.supply_id"), nullable=False, index=True)
    validated_by = Column(UUID_COLUMN, ForeignKey("users.id"), nullable=False)
    planning_remarks = Column(String(2000), nullable=True)
    validation_timestamp = Column(DateTime, nullable=False, default=now_ist)
    is_approved = Column(String(10), nullable=False, default="Pending")  # Approved, Sent Back, Pending
    
    # Relationships
    requisition = relationship("ConcreteRequisition", back_populates="planning_validation")
    validator = relationship("User", back_populates="validations")
    
    def __repr__(self):
        return f"<PlanningValidation(validation_id={self.validation_id}, supply_id={self.supply_id})>"


class ProductionDispatch(Base):
    """
    Production dispatch record.
    Tracks Transit Mixer (TM) assignments, dispatch, and delivery details.
    Wastage is calculated as: (RequestedQTY - ActualDispatchedQTY)
    ACE (Acceptable Concrete Expense) Limit: Wastage % must be < 1%
    """
    __tablename__ = "production_dispatch"
    
    dispatch_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    supply_id = Column(String(50), ForeignKey("concrete_requisitions.supply_id"), nullable=False, index=True)
    batching_plant_id = Column(String(100), nullable=True)
    tm_number = Column(String(50), nullable=False)  # Transit Mixer number
    actual_dispatched_qty = Column(Float, nullable=False)  # Cubic meters
    dispatch_time = Column(DateTime, nullable=False)
    receipt_location = Column(String(500), nullable=True)
    delivery_time = Column(DateTime, nullable=True)
    receipt_at_site_time = Column(DateTime, nullable=True)
    release_from_site_time = Column(DateTime, nullable=True)
    return_to_plant_time = Column(DateTime, nullable=True)
    remarks = Column(String(2000), nullable=True)
    wastage_qty = Column(Float, nullable=True)  # Calculated: requested_qty - actual_dispatched_qty
    returned_wastage_qty = Column(Float, nullable=False, default=0)
    remaining_concrete_disposition = Column(String(50), nullable=True)
    pending_secondary_qty = Column(Float, nullable=False, default=0)
    pending_secondary_receipt_location = Column(String(500), nullable=True)
    pending_secondary_receipt_structure_name = Column(String(255), nullable=True)
    pending_secondary_receipt_structure_id = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    updated_at = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)
    
    # Relationships
    requisition = relationship("ConcreteRequisition", back_populates="dispatch_logs")
    receipt_allocations = relationship(
        "DispatchReceiptAllocation",
        back_populates="dispatch",
        cascade="all, delete-orphan",
    )
    
    def calculate_wastage(self, requested_qty: float) -> float:
        """Calculate wastage quantity"""
        return max(0, requested_qty - self.actual_dispatched_qty)
    
    def calculate_wastage_percentage(self, requested_qty: float) -> float:
        """Calculate wastage percentage. Critical KPI: must be < 1%"""
        if requested_qty == 0:
            return 0.0
        return (self.calculate_wastage(requested_qty) / requested_qty) * 100
    
    def __repr__(self):
        return f"<ProductionDispatch(dispatch_id={self.dispatch_id}, tm_number={self.tm_number})>"


class DispatchReceiptAllocation(Base):
    """
    Concrete deposited from a dispatched TM into one actual receipt destination.

    A single plant dispatch can be allocated across multiple structures at site.
    Keeping these rows separate preserves the original dispatched vehicle quantity
    while recording where the concrete was actually used.
    """
    __tablename__ = "dispatch_receipt_allocations"

    allocation_id = Column(UUID_COLUMN, primary_key=True, default=lambda: str(uuid.uuid4()))
    dispatch_id = Column(UUID_COLUMN, ForeignKey("production_dispatch.dispatch_id"), nullable=False, index=True)
    deposited_qty = Column(Float, nullable=False)
    receipt_location = Column(String(500), nullable=False)
    receipt_structure_name = Column(String(255), nullable=False)
    receipt_structure_id = Column(String(50), nullable=False)
    receipt_at_site_time = Column(DateTime, nullable=False)
    release_from_site_time = Column(DateTime, nullable=False)
    remarks = Column(String(2000), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now_ist)
    updated_at = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)

    dispatch = relationship("ProductionDispatch", back_populates="receipt_allocations")

    def __repr__(self):
        return (
            "<DispatchReceiptAllocation("
            f"dispatch_id={self.dispatch_id}, deposited_qty={self.deposited_qty})>"
        )
