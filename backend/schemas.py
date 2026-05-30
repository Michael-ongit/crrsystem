# schemas.py - Pydantic V2 models for request/response validation
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime
from typing import Optional, List
from enum import Enum


class UserRole(str, Enum):
    """User role enumeration"""
    EXECUTION = "Execution"
    PLANNING = "Planning"
    PRODUCTION = "Production"
    ADMIN = "Admin"
    PLANNING_MANAGER = "Planning Manager"
    PROJECT_MANAGER = "Project Manager"
    HQ_PROJECT_COORDINATOR = "HQ Project Coordinator"


class RequisitionStatus(str, Enum):
    """Requisition status enumeration"""
    PENDING = "Pending"
    VALIDATED = "Validated"
    DISPATCHED = "Dispatched"
    RETURNING = "Returning"
    RECONCILED = "Reconciled"


# ============== USER SCHEMAS ==============

class UserCreate(BaseModel):
    """Schema for creating a new user"""
    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = Field(default=UserRole.EXECUTION)
    assigned_locations: List[str] = Field(default_factory=list)

    @field_validator('name')
    @classmethod
    def normalize_name(cls, v: str) -> str:
        return v.strip()
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Validate email format"""
        v = v.strip().lower()
        if '@' not in v or '.' not in v:
            raise ValueError('Invalid email format')
        return v


class UserUpdate(BaseModel):
    """Schema for admin edits to a system user"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[str] = Field(None, min_length=5, max_length=255)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    role: Optional[UserRole] = None
    assigned_locations: Optional[List[str]] = None
    is_email_verified: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def normalize_optional_name(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v is not None else v

    @field_validator('email')
    @classmethod
    def validate_optional_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if '@' not in v or '.' not in v:
            raise ValueError('Invalid email format')
        return v


class UserResponse(BaseModel):
    """Schema for user response"""
    id: str
    name: str
    email: str
    role: UserRole
    assigned_locations: List[str] = Field(default_factory=list)
    is_email_verified: bool = False
    created_at: datetime
    
    class Config:
        from_attributes = True


class RegistrationInviteCreate(BaseModel):
    """Admin-created registration permission for one email address."""
    email: str = Field(..., min_length=5, max_length=255)
    name_hint: Optional[str] = Field(None, max_length=255)
    role: UserRole = Field(default=UserRole.EXECUTION)
    assigned_locations: List[str] = Field(default_factory=list)
    is_active: bool = True

    @field_validator('email')
    @classmethod
    def normalize_invite_email(cls, v: str) -> str:
        v = v.strip().lower()
        if '@' not in v or '.' not in v:
            raise ValueError('Invalid email format')
        return v


class RegistrationInviteUpdate(BaseModel):
    name_hint: Optional[str] = Field(None, max_length=255)
    role: Optional[UserRole] = None
    assigned_locations: Optional[List[str]] = None
    is_active: Optional[bool] = None


class RegistrationInviteResponse(BaseModel):
    invite_id: str
    email: str
    name_hint: Optional[str] = None
    role: UserRole
    assigned_locations: List[str] = Field(default_factory=list)
    is_active: bool
    registered_user_id: Optional[str] = None
    registered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DropdownOptionCreate(BaseModel):
    category: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1, max_length=255)
    label: Optional[str] = Field(None, max_length=255)
    is_active: bool = True
    sort_order: int = 0

    @field_validator('category', 'value', 'label')
    @classmethod
    def normalize_dropdown_text(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if isinstance(v, str) else v


class DropdownOptionUpdate(BaseModel):
    value: Optional[str] = Field(None, min_length=1, max_length=255)
    label: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None

    @field_validator('value', 'label')
    @classmethod
    def normalize_optional_dropdown_text(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if isinstance(v, str) else v


class DropdownOptionResponse(BaseModel):
    option_id: str
    category: str
    value: str
    label: Optional[str] = None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RequisitionElementCreate(BaseModel):
    location: str = Field(..., min_length=1, max_length=100)
    structure_type: str = Field(..., min_length=1, max_length=100)
    structure_name: str = Field(..., min_length=1, max_length=100)
    structure_id: str = Field(..., min_length=1, max_length=100)
    element_id: Optional[str] = Field(None, max_length=100)


class RequisitionElementUpdate(BaseModel):
    location: Optional[str] = Field(None, min_length=1, max_length=100)
    structure_type: Optional[str] = Field(None, min_length=1, max_length=100)
    structure_name: Optional[str] = Field(None, min_length=1, max_length=100)
    structure_id: Optional[str] = Field(None, min_length=1, max_length=100)
    element_id: Optional[str] = Field(None, max_length=100)


class RequisitionElementResponse(BaseModel):
    id: int
    location: str
    structure_type: str
    structure_name: str
    structure_id: str
    element_id: Optional[str] = None

    class Config:
        from_attributes = True


# ============== CONCRETE REQUISITION SCHEMAS ==============

class ConcreteRequisitionCreate(BaseModel):
    """Schema for creating a new concrete requisition"""
    rfi_no: Optional[str] = Field(None, max_length=100)
    requisition_date: Optional[str] = Field(None, max_length=20)
    location: str = Field(..., min_length=3, max_length=500)
    in_charge_id: str = Field(..., description="UUID of the responsible person")
    in_charge_name: Optional[str] = Field(None, max_length=255)
    selected_in_charge: Optional[str] = Field(None, max_length=255)
    structure_type: Optional[str] = Field(None, max_length=100)
    structure_name: str = Field(..., min_length=1, max_length=255)
    structure_id: str = Field(..., min_length=1, max_length=50)
    pile_lift_id: Optional[str] = Field(None, max_length=100)
    grade: str = Field(..., min_length=2, max_length=50, description="Concrete grade e.g., M40, M50")
    drawing_no: Optional[str] = Field(None, max_length=255)
    drawing_length: Optional[float] = None
    drawing_diameter: Optional[float] = None
    theoretical_qty: Optional[float] = None
    actual_length: Optional[float] = None
    actual_diameter: Optional[float] = None
    actual_qty: Optional[float] = None
    qty_difference: Optional[float] = None
    difference_reason: Optional[str] = Field(None, max_length=500)
    requested_qty: float = Field(..., gt=0, description="Quantity in cubic meters")
    pour_time: Optional[str] = Field(None, max_length=20)
    placement_by: Optional[str] = Field(None, max_length=255)
    contact_person: Optional[str] = Field(None, max_length=255)
    contact_number: Optional[str] = Field(None, max_length=50)
    
    @field_validator('requested_qty')
    @classmethod
    def validate_quantity(cls, v: float) -> float:
        """Ensure quantity is positive and reasonable"""
        if v <= 0 or v > 10000:
            raise ValueError('Requested quantity must be between 0 and 10000 cubic meters')
        return round(v, 2)


class SupplyIdPreviewResponse(BaseModel):
    """Schema for generated Supply ID preview"""
    supply_id: str
    pattern: str


class ConcreteRequisitionUpdate(BaseModel):
    """Schema for updating a concrete requisition status"""
    status: RequisitionStatus


class ConcreteRequisitionResponse(BaseModel):
    """Schema for concrete requisition response"""
    supply_id: str
    req_date: datetime
    rfi_no: Optional[str] = None
    requisition_date: Optional[str] = None
    location: str
    in_charge_id: str
    in_charge_name: Optional[str] = None
    selected_in_charge: Optional[str] = None
    placed_by_id: Optional[str] = None
    placed_by_name: Optional[str] = None
    placed_by_email: Optional[str] = None
    structure_type: Optional[str] = None
    structure_name: str
    structure_id: str
    pile_lift_id: Optional[str] = None
    grade: str
    drawing_no: Optional[str] = None
    drawing_length: Optional[float] = None
    drawing_diameter: Optional[float] = None
    theoretical_qty: Optional[float] = None
    actual_length: Optional[float] = None
    actual_diameter: Optional[float] = None
    actual_qty: Optional[float] = None
    qty_difference: Optional[float] = None
    difference_reason: Optional[str] = None
    requested_qty: float
    pour_time: Optional[str] = None
    placement_by: Optional[str]
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None
    status: RequisitionStatus
    approval_status: Optional[str] = None
    planning_remarks: Optional[str] = None
    validation_timestamp: Optional[datetime] = None
    sent_back_expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ============== PLANNING VALIDATION SCHEMAS ==============

class PlanningValidationCreate(BaseModel):
    """Schema for creating a planning validation record"""
    supply_id: Optional[str] = Field(None, description="Supply ID to validate")
    validated_by: str = Field(..., description="UUID of the validator")
    planning_remarks: Optional[str] = Field(None, max_length=2000)
    is_approved: str = Field(..., description="Approved, Sent Back, or Pending")
    
    @field_validator('is_approved')
    @classmethod
    def validate_approval_status(cls, v: str) -> str:
        """Ensure approval status is valid"""
        if v not in ["Approved", "Sent Back", "Pending"]:
            raise ValueError('Approval status must be Approved, Sent Back, or Pending')
        return v


class PlanningValidationResponse(BaseModel):
    """Schema for planning validation response"""
    validation_id: str
    supply_id: str
    validated_by: str
    planning_remarks: Optional[str]
    validation_timestamp: datetime
    is_approved: str
    
    class Config:
        from_attributes = True


# ============== PRODUCTION DISPATCH SCHEMAS ==============

class ProductionDispatchCreate(BaseModel):
    """Schema for creating a production dispatch record"""
    supply_id: str = Field(..., description="Supply ID being dispatched")
    batching_plant_id: str = Field(..., min_length=1, max_length=100, description="Batching plant ID")
    tm_number: str = Field(..., min_length=1, max_length=50, description="Allocated vehicle")
    actual_dispatched_qty: float = Field(..., gt=0, description="Actual dispatched quantity in cubic meters")
    dispatch_time: datetime = Field(..., description="Time of dispatch")
    receipt_location: str = Field(..., min_length=1, max_length=500, description="Receipt location")
    delivery_time: Optional[datetime] = Field(None, description="Time of delivery")
    
    @field_validator('actual_dispatched_qty')
    @classmethod
    def validate_dispatch_qty(cls, v: float) -> float:
        """Ensure dispatch quantity is reasonable"""
        if v <= 0 or v > 10000:
            raise ValueError('Dispatched quantity must be between 0 and 10000 cubic meters')
        return round(v, 2)


class DispatchReceiptAllocationResponse(BaseModel):
    """Concrete quantity deposited at one actual receipt destination."""
    allocation_id: str
    dispatch_id: str
    deposited_qty: float
    receipt_location: str
    receipt_structure_name: str
    receipt_structure_id: str
    receipt_at_site_time: datetime
    release_from_site_time: datetime
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProductionDispatchResponse(BaseModel):
    """Schema for production dispatch response"""
    dispatch_id: str
    supply_id: str
    batching_plant_id: Optional[str] = None
    tm_number: str
    actual_dispatched_qty: float
    dispatch_time: datetime
    receipt_location: Optional[str] = None
    delivery_time: Optional[datetime]
    receipt_at_site_time: Optional[datetime] = None
    release_from_site_time: Optional[datetime] = None
    return_to_plant_time: Optional[datetime] = None
    remarks: Optional[str] = None
    wastage_qty: Optional[float]
    returned_wastage_qty: float = 0.0
    remaining_concrete_disposition: Optional[str] = None
    pending_secondary_qty: float = 0.0
    pending_secondary_receipt_location: Optional[str] = None
    pending_secondary_receipt_structure_name: Optional[str] = None
    pending_secondary_receipt_structure_id: Optional[str] = None
    receipt_allocations: List[DispatchReceiptAllocationResponse] = Field(default_factory=list)
    allocated_qty: float = 0.0
    remaining_qty: float = 0.0
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class RegisterRequest(BaseModel):
    """Schema for public user registration"""
    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = Field(default=UserRole.EXECUTION)

    @field_validator('name')
    @classmethod
    def normalize_name(cls, v: str) -> str:
        return v.strip()

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if '@' not in v or '.' not in v:
            raise ValueError('Invalid email format')
        return v


class RegisterResponse(BaseModel):
    """Registration response"""
    message: str
    email: str


class LoginRequest(BaseModel):
    """Schema for user login"""
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator('email')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class AuthResponse(BaseModel):
    """Authenticated session response"""
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse


class MessageResponse(BaseModel):
    """Generic message response"""
    message: str


class DeliveryTimeUpdate(BaseModel):
    """Schema for updating dispatch delivery time"""
    delivery_time: datetime


class DispatchReconciliationUpdate(BaseModel):
    """Schema for acknowledging receipt and reconciling a dispatched order"""
    receipt_at_site_time: datetime
    release_from_site_time: datetime
    return_to_plant_time: datetime
    remarks: Optional[str] = Field(None, max_length=2000)


class DispatchAcknowledgementUpdate(BaseModel):
    """Schema for acknowledging site receipt and release before plant return"""
    details_match: bool = True
    receipt_at_site_time: datetime
    release_from_site_time: datetime
    deposited_qty: Optional[float] = Field(None, gt=0, le=10000)
    receipt_location: Optional[str] = Field(None, max_length=500)
    receipt_structure_name: Optional[str] = Field(None, max_length=255)
    receipt_structure_id: Optional[str] = Field(None, max_length=50)
    remaining_disposition: Optional[str] = Field(None, max_length=50)
    secondary_receipt_location: Optional[str] = Field(None, max_length=500)
    secondary_receipt_structure_name: Optional[str] = Field(None, max_length=255)
    secondary_receipt_structure_id: Optional[str] = Field(None, max_length=50)
    remarks: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def validate_partial_receipt_details(self):
        if self.details_match:
            return self

        missing_fields = []
        if self.deposited_qty is None:
            missing_fields.append("deposited_qty")
        if not self.receipt_location or not self.receipt_location.strip():
            missing_fields.append("receipt_location")
        if not self.receipt_structure_name or not self.receipt_structure_name.strip():
            missing_fields.append("receipt_structure_name")
        if not self.receipt_structure_id or not self.receipt_structure_id.strip():
            missing_fields.append("receipt_structure_id")

        if missing_fields:
            raise ValueError(
                "Partial acknowledgement requires: " + ", ".join(missing_fields)
            )
        return self


class ReturnToPlantUpdate(BaseModel):
    """Schema for closing a dispatched order after the mixer returns to plant"""
    return_to_plant_time: datetime
    remarks: Optional[str] = Field(None, max_length=2000)


# ============== DASHBOARD / ANALYTICS SCHEMAS ==============

class WastageRecord(BaseModel):
    """Schema for wastage tracking record"""
    supply_id: str
    requested_qty: float
    actual_dispatched_qty: float
    wastage_qty: float
    wastage_percentage: float
    exceeds_ace_limit: bool = Field(description="True if wastage > 1%")
    dispatch_date: datetime
    tm_numbers: List[str]


class TurnaroundTimeRecord(BaseModel):
    """Schema for TM turnaround time tracking"""
    tm_number: str
    dispatch_time: datetime
    delivery_time: Optional[datetime]
    turnaround_hours: Optional[float]
    status: str


class DashboardSummary(BaseModel):
    """Schema for dashboard summary data"""
    total_requisitions: int
    pending_count: int
    validated_count: int
    dispatched_count: int
    reconciled_count: int
    average_wastage_percentage: float
    violation_count: int = Field(description="Count of supplies exceeding 1% ACE limit")
    wastage_records: List[WastageRecord]
    turnaround_records: List[TurnaroundTimeRecord]
    
    class Config:
        from_attributes = True


class ErrorResponse(BaseModel):
    """Schema for error responses"""
    status_code: int
    message: str
    detail: Optional[str] = None
