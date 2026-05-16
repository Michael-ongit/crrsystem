# routers/requisitions.py - Concrete requisition endpoints
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from database import get_db
from models import ConcreteRequisition, PlanningValidation, User, RequisitionStatus, UserRole
from . import auth
from schemas import (
    ConcreteRequisitionCreate, ConcreteRequisitionResponse,
    PlanningValidationCreate, PlanningValidationResponse,
    SupplyIdPreviewResponse
)
from datetime import datetime
import logging
import re

router = APIRouter(prefix="/requisitions", tags=["Requisitions"])
logger = logging.getLogger(__name__)


def _attach_latest_planning(requisition: ConcreteRequisition, db: Session) -> ConcreteRequisition:
    latest_validation = (
        db.query(PlanningValidation)
        .filter(PlanningValidation.supply_id == requisition.supply_id)
        .order_by(PlanningValidation.validation_timestamp.desc())
        .first()
    )
    requisition.approval_status = latest_validation.is_approved if latest_validation else None
    requisition.planning_remarks = latest_validation.planning_remarks if latest_validation else None
    requisition.validation_timestamp = latest_validation.validation_timestamp if latest_validation else None
    return requisition


def _compact_token(value: str, max_length: int, fallback: str) -> str:
    """Create a short stable token from user-entered project fields."""
    words = re.findall(r"[A-Za-z0-9]+", value.upper())
    if not words:
        return fallback

    if len(words) > 1:
        token = "".join(word[:3] for word in words)
    else:
        token = words[0]

    token = re.sub(r"[^A-Z0-9]", "", token)
    return (token[:max_length] or fallback)


def _supply_id_base(location: str, structure_name: str, structure_id: str) -> str:
    location_code = _compact_token(location, 5, "SITE")
    structure_code = _compact_token(structure_name, 6, "STRUCT")
    structure_id_code = _compact_token(structure_id, 8, "ID")
    date_code = datetime.utcnow().strftime("%y%m%d")
    return f"MVDP-{location_code}-{structure_code}-{structure_id_code}-{date_code}"


def generate_supply_id(
    db: Session,
    location: str,
    structure_name: str,
    structure_id: str,
) -> str:
    """
    Generate the next Supply ID for a requisition.

    Format: MVDP-{site}-{structure}-{structure_id}-{YYMMDD}-{sequence}
    Example: MVDP-PIERF-PIER01-STR001-260508-001
    """
    base = _supply_id_base(location, structure_name, structure_id)
    existing_ids = (
        db.query(ConcreteRequisition.supply_id)
        .filter(ConcreteRequisition.supply_id.like(f"{base}-%"))
        .all()
    )

    highest_sequence = 0
    for (supply_id,) in existing_ids:
        suffix = supply_id.rsplit("-", 1)[-1]
        if suffix.isdigit():
            highest_sequence = max(highest_sequence, int(suffix))

    return f"{base}-{highest_sequence + 1:03d}"


@router.get(
    "/supply-id/preview",
    response_model=SupplyIdPreviewResponse,
    summary="Preview generated Supply ID",
    description="Generate a preview Supply ID from location, structure name, and structure ID."
)
def preview_supply_id(
    location: str,
    structure_name: str,
    structure_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Preview the next generated Supply ID without creating a requisition."""
    if len(location.strip()) < 3 or not structure_name.strip() or not structure_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location, structure name, and structure ID are required to preview a Supply ID"
        )

    return SupplyIdPreviewResponse(
        supply_id=generate_supply_id(db, location, structure_name, structure_id),
        pattern="MVDP-{site}-{structure}-{structure_id}-{YYMMDD}-{sequence}"
    )


@router.post(
    "/",
    response_model=ConcreteRequisitionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new concrete requisition",
    description="Execution team creates a new concrete supply requisition."
)
def create_requisition(
    requisition: ConcreteRequisitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.EXECUTION, UserRole.ADMIN)),
):
    """
    Create a new concrete requisition.
    
    - **supply_id**: Generated automatically from location, structure name, structure ID, date, and sequence
    - **location**: Physical location of the site
    - **in_charge_id**: UUID of the responsible person
    - **structure_id**: Identifies the structure/section
    - **grade**: Concrete grade (e.g., M40, M50)
    - **requested_qty**: Quantity in cubic meters
    """
    try:
        # Verify that in_charge_id exists
        user = db.query(User).filter(User.id == requisition.in_charge_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id '{requisition.in_charge_id}' not found"
            )
        
        db_requisition = None
        for _ in range(3):
            generated_supply_id = generate_supply_id(
                db,
                requisition.location,
                requisition.structure_name,
                requisition.structure_id,
            )

            db_requisition = ConcreteRequisition(
                supply_id=generated_supply_id,
                rfi_no=requisition.rfi_no,
                requisition_date=requisition.requisition_date,
                location=requisition.location,
                in_charge_id=requisition.in_charge_id,
                structure_type=requisition.structure_type,
                structure_name=requisition.structure_name,
                structure_id=requisition.structure_id,
                pile_lift_id=requisition.pile_lift_id,
                grade=requisition.grade,
                drawing_no=requisition.drawing_no,
                drawing_length=requisition.drawing_length,
                drawing_diameter=requisition.drawing_diameter,
                theoretical_qty=requisition.theoretical_qty,
                actual_length=requisition.actual_length,
                actual_diameter=requisition.actual_diameter,
                actual_qty=requisition.actual_qty,
                qty_difference=requisition.qty_difference,
                difference_reason=requisition.difference_reason,
                requested_qty=requisition.requested_qty,
                pour_time=requisition.pour_time,
                placement_by=requisition.placement_by,
                contact_person=requisition.contact_person,
                contact_number=requisition.contact_number,
                status=RequisitionStatus.PENDING
            )

            db.add(db_requisition)
            try:
                db.commit()
                db.refresh(db_requisition)
                break
            except IntegrityError:
                db.rollback()
                logger.warning("Supply ID collision detected, retrying generation")
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Unable to generate a unique Supply ID. Please try again."
            )
        
        logger.info(f"Requisition created: {db_requisition.supply_id}")
        return _attach_latest_planning(db_requisition, db)
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating requisition: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create requisition"
        )


@router.get(
    "/",
    response_model=list[ConcreteRequisitionResponse],
    summary="Get all requisitions",
    description="Retrieve all concrete requisitions with optional filtering."
)
def get_requisitions(
    status_filter: str = None,
    db: Session = Depends(get_db)
):
    """
    Get all concrete requisitions.
    
    - **status_filter** (optional): Filter by status (Pending, Validated, Dispatched, Reconciled)
    """
    try:
        query = db.query(ConcreteRequisition)
        
        if status_filter:
            query = query.filter(ConcreteRequisition.status == status_filter)
        
        requisitions = query.order_by(ConcreteRequisition.req_date.desc()).all()
        for requisition in requisitions:
            _attach_latest_planning(requisition, db)
        return requisitions
        
    except Exception as e:
        logger.error(f"Error fetching requisitions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch requisitions"
        )


@router.get(
    "/{supply_id}",
    response_model=ConcreteRequisitionResponse,
    summary="Get requisition by supply ID"
)
def get_requisition(
    supply_id: str,
    db: Session = Depends(get_db)
):
    """Get a specific requisition by supply_id"""
    try:
        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == supply_id
        ).first()
        
        if not requisition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Requisition with supply_id '{supply_id}' not found"
            )

        return _attach_latest_planning(requisition, db)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching requisition {supply_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch requisition"
        )


@router.put(
    "/{supply_id}/validate",
    response_model=PlanningValidationResponse,
    summary="Planning validation endpoint",
    description="Planning team validates/approves a pending requisition."
)
def validate_requisition(
    supply_id: str,
    validation: PlanningValidationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.PLANNING, UserRole.ADMIN)),
):
    """
    Validate a concrete requisition by the Planning team.
    
    - Updates requisition status to 'Validated' if approved.
    - Creates a PlanningValidation record with remarks.
    - **is_approved**: Must be 'Approved', 'Rejected', or 'Pending'
    """
    try:
        # Fetch the requisition
        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == supply_id
        ).first()
        
        if not requisition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Requisition with supply_id '{supply_id}' not found"
            )

        if validation.supply_id and validation.supply_id != supply_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Supply ID in request body does not match the URL"
            )
        
        # Check if requisition is in Pending status
        if requisition.status != RequisitionStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Requisition must be in Pending status to validate. Current status: {requisition.status}"
            )
        
        # Verify validator exists
        validator = db.query(User).filter(User.id == validation.validated_by).first()
        if not validator:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Validator user with id '{validation.validated_by}' not found"
            )
        
        # Create validation record
        db_validation = PlanningValidation(
            supply_id=supply_id,
            validated_by=validation.validated_by,
            planning_remarks=validation.planning_remarks,
            is_approved=validation.is_approved,
            validation_timestamp=datetime.utcnow()
        )
        
        # Update requisition status based on approval
        if validation.is_approved == "Approved":
            requisition.status = RequisitionStatus.VALIDATED
        elif validation.is_approved == "Rejected":
            requisition.status = RequisitionStatus.PENDING  # Keep in pending; can be modified
        # If "Pending", status stays as is
        
        requisition.updated_at = datetime.utcnow()
        
        db.add(db_validation)
        db.commit()
        db.refresh(db_validation)
        
        logger.info(f"Requisition validated: {supply_id}, Status: {validation.is_approved}")
        return db_validation
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error validating requisition {supply_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to validate requisition"
        )
