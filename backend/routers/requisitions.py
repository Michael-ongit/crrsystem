# routers/requisitions.py - Concrete requisition endpoints
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from database import get_db
from models import (
    ConcreteRequisition, DropdownOption, PlanningValidation, ProductionDispatch, RequisitionElement,
    RequisitionStatus, SupplySequence, User, UserRole
)
from . import auth
from email_service import (
    order_placed_email,
    planning_decision_email,
    send_notification,
    users_by_role,
)
from schemas import (
    ConcreteRequisitionCreate, ConcreteRequisitionResponse,
    PlanningValidationCreate, PlanningValidationResponse,
    SupplyIdPreviewResponse
)
from datetime import timedelta
from time_utils import now_ist
import logging
import re

router = APIRouter(prefix="/requisitions", tags=["Requisitions"])
logger = logging.getLogger(__name__)
SEND_BACK_EDIT_WINDOW_HOURS = 12


def _apply_location_scope(query, current_user: User, location_scope: str | None):
    if location_scope != "assigned" or current_user.role != UserRole.EXECUTION:
        return query

    locations = current_user.assigned_locations
    if locations:
        return query.filter(
            (ConcreteRequisition.location.in_(locations))
            | ConcreteRequisition.dispatch_logs.any(
                ProductionDispatch.pending_secondary_receipt_location.in_(locations)
            )
        )
    return query.filter(
        (ConcreteRequisition.in_charge_id == current_user.id)
        | (ConcreteRequisition.placed_by_id == current_user.id)
    )


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
    requisition.sent_back_expires_at = (
        latest_validation.validation_timestamp + timedelta(hours=SEND_BACK_EDIT_WINDOW_HOURS)
        if latest_validation and latest_validation.is_approved == "Sent Back"
        else None
    )
    return requisition


def _latest_planning_validation(supply_id: str, db: Session) -> PlanningValidation | None:
    return (
        db.query(PlanningValidation)
        .filter(PlanningValidation.supply_id == supply_id)
        .order_by(PlanningValidation.validation_timestamp.desc())
        .first()
    )


def _apply_requisition_payload(
    db_requisition: ConcreteRequisition,
    requisition: ConcreteRequisitionCreate,
) -> None:
    db_requisition.rfi_no = requisition.rfi_no
    db_requisition.requisition_date = requisition.requisition_date
    db_requisition.location = requisition.location
    db_requisition.in_charge_id = requisition.in_charge_id
    db_requisition.in_charge_name = requisition.in_charge_name
    db_requisition.selected_in_charge = requisition.selected_in_charge
    db_requisition.structure_type = requisition.structure_type
    db_requisition.structure_name = requisition.structure_name
    db_requisition.structure_id = requisition.structure_id
    db_requisition.pile_lift_id = requisition.pile_lift_id
    db_requisition.grade = requisition.grade
    db_requisition.drawing_no = requisition.drawing_no
    db_requisition.drawing_length = requisition.drawing_length
    db_requisition.drawing_diameter = requisition.drawing_diameter
    db_requisition.theoretical_qty = requisition.theoretical_qty
    db_requisition.actual_length = requisition.actual_length
    db_requisition.actual_diameter = requisition.actual_diameter
    db_requisition.actual_qty = requisition.actual_qty
    db_requisition.qty_difference = requisition.qty_difference
    db_requisition.difference_reason = requisition.difference_reason
    db_requisition.requested_qty = requisition.requested_qty
    db_requisition.pour_time = requisition.pour_time
    db_requisition.placement_by = requisition.placement_by
    db_requisition.contact_person = requisition.contact_person
    db_requisition.contact_number = requisition.contact_number


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
    date_code = now_ist().strftime("%y%m%d")
    return f"MVDP-{location_code}-{structure_code}-{structure_id_code}-{date_code}"


def preview_supply_id_value(db: Session, location: str, structure_name: str, structure_id: str) -> str:
    """Preview the next likely Supply ID without reserving or incrementing it."""
    base = _supply_id_base(location, structure_name, structure_id)
    sequence = db.query(SupplySequence).filter(SupplySequence.base_code == base).one_or_none()
    current_sequence = sequence.current_sequence if sequence else 0
    return f"{base}-{current_sequence + 1:03d}"


def generate_supply_id(
    db: Session,
    location: str,
    structure_name: str,
    structure_id: str,
) -> str:
    """
    Generate a supply ID using an atomic sequence row per immutable base code.

    The matching SupplySequence row is selected with ``FOR UPDATE`` where the
    active database supports row-level locks. This avoids two concurrent
    requests reading the same max suffix and issuing duplicate IDs.
    """
    base = _supply_id_base(location, structure_name, structure_id)

    for _ in range(3):
        try:
            sequence = (
                db.query(SupplySequence)
                .filter(SupplySequence.base_code == base)
                .with_for_update()
                .one_or_none()
            )

            if sequence is None:
                sequence = SupplySequence(base_code=base, current_sequence=1)
                db.add(sequence)
                next_sequence = 1
            else:
                sequence.current_sequence += 1
                next_sequence = sequence.current_sequence

            db.commit()
            return f"{base}-{next_sequence:03d}"
        except IntegrityError:
            db.rollback()
            logger.warning("Supply sequence collision detected for %s; retrying", base)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Unable to generate a unique Supply ID. Please try again."
    )


def _distinct_strings(query) -> list[str]:
    """Normalize distinct scalar query output into a sorted JSON string array."""
    values = [value for (value,) in query.distinct().all() if value]
    return sorted(values, key=lambda item: item.lower())


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
        supply_id=preview_supply_id_value(db, location, structure_name, structure_id),
        pattern="MVDP-{site}-{structure}-{structure_id}-{YYMMDD}-{sequence}"
    )


@router.get(
    "/meta/locations",
    response_model=list[str],
    summary="List requisition locations",
)
def get_requisition_locations(db: Session = Depends(get_db)) -> list[str]:
    """Return all distinct master-data locations available for requisitions."""
    return _distinct_strings(db.query(RequisitionElement.location))


@router.get(
    "/meta/structure-types",
    response_model=list[str],
    summary="List structure types for a location",
)
def get_requisition_structure_types(
    location: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """Return structure types; depends on the selected ``location`` parent."""
    query = db.query(RequisitionElement.structure_type).filter(
        RequisitionElement.location == location
    )
    return _distinct_strings(query)


@router.get(
    "/meta/structure-names",
    response_model=list[str],
    summary="List structure names for location and type",
)
def get_requisition_structure_names(
    location: str,
    structure_type: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """Return structure names; depends on ``location`` and ``structure_type``."""
    query = db.query(RequisitionElement.structure_name).filter(
        RequisitionElement.location == location,
        RequisitionElement.structure_type == structure_type,
    )
    return _distinct_strings(query)


@router.get(
    "/meta/structure-ids",
    response_model=list[str],
    summary="List structure IDs for the selected hierarchy path",
)
def get_requisition_structure_ids(
    location: str,
    structure_type: str,
    structure_name: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """Return structure IDs; depends on location, type, and structure name."""
    query = db.query(RequisitionElement.structure_id).filter(
        RequisitionElement.location == location,
        RequisitionElement.structure_type == structure_type,
        RequisitionElement.structure_name == structure_name,
    )
    return _distinct_strings(query)


@router.get(
    "/meta/element-ids",
    response_model=list[str],
    summary="List element IDs for the selected structure path",
)
def get_requisition_element_ids(
    location: str,
    structure_type: str,
    structure_name: str,
    structure_id: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """
    Return element IDs; depends on the full location/type/name/structure ID path.

    Empty values are intentionally omitted because many structure rows do not
    define a lower-level pile/lift/girder/segment element.
    """
    query = db.query(RequisitionElement.element_id).filter(
        RequisitionElement.location == location,
        RequisitionElement.structure_type == structure_type,
        RequisitionElement.structure_name == structure_name,
        RequisitionElement.structure_id == structure_id,
    )
    return _distinct_strings(query)


@router.get(
    "/meta/filter-options",
    response_model=list[str],
    summary="List distinct lookup options for filter panels",
)
def get_requisition_filter_options(
    field: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """
    Return distinct values for a reference-data column used by UI filters.

    This endpoint keeps history table filters efficient: they can populate one
    searchable multi-select without traversing every hierarchy branch.
    """
    columns = {
        "location": RequisitionElement.location,
        "structure_type": RequisitionElement.structure_type,
        "structure_name": RequisitionElement.structure_name,
        "structure_id": RequisitionElement.structure_id,
        "pile_lift_id": RequisitionElement.element_id,
    }
    if field not in columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported filter option field"
        )
    return _distinct_strings(db.query(columns[field]))


@router.get(
    "/meta/dropdown-options",
    response_model=list[str],
    summary="List active admin-managed dropdown options",
)
def get_dropdown_options(
    category: str,
    db: Session = Depends(get_db),
) -> list[str]:
    """Return active dropdown values maintained from the Admin page."""
    values = (
        db.query(DropdownOption.value)
        .filter(
            DropdownOption.category == category,
            DropdownOption.is_active.is_(True),
        )
        .order_by(DropdownOption.sort_order.asc(), DropdownOption.value.asc())
        .all()
    )
    return [value for (value,) in values if value]


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
    current_user: User = Depends(auth.require_roles(UserRole.EXECUTION, *auth.OPERATIONAL_ACCESS_ROLES)),
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
        
        generated_supply_id = generate_supply_id(
            db,
            requisition.location,
            requisition.structure_name,
            requisition.structure_id,
        )

        db_requisition = ConcreteRequisition(
            supply_id=generated_supply_id,
            status=RequisitionStatus.PENDING,
            placed_by_id=current_user.id,
            placed_by_name=current_user.name,
            placed_by_email=current_user.email,
        )
        _apply_requisition_payload(db_requisition, requisition)

        db.add(db_requisition)
        db.commit()
        db.refresh(db_requisition)
        
        logger.info(f"Requisition created: {db_requisition.supply_id}")
        send_notification(
            subject=f"Concrete order placed: {db_requisition.supply_id}",
            body=order_placed_email(db_requisition),
            recipients=users_by_role(db, UserRole.PLANNING),
        )
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
    location_scope: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Get all concrete requisitions.
    
    - **status_filter** (optional): Filter by status (Pending, Validated, Dispatched, Reconciled)
    """
    try:
        query = db.query(ConcreteRequisition)
        query = _apply_location_scope(query, current_user, location_scope)
        
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
    "/{supply_id}/resubmit",
    response_model=ConcreteRequisitionResponse,
    summary="Resubmit a sent-back requisition",
    description="Execution updates a sent-back requisition under the same Supply ID within 12 hours."
)
def resubmit_sent_back_requisition(
    supply_id: str,
    requisition: ConcreteRequisitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.EXECUTION, *auth.OPERATIONAL_ACCESS_ROLES)),
):
    """
    Update the existing requisition after Planning sends it back.

    The original Supply ID is preserved. Resubmission is allowed only when the
    latest planning validation is ``Sent Back`` and the 12-hour edit window has
    not expired.
    """
    try:
        db_requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == supply_id
        ).first()

        if not db_requisition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Requisition with supply_id '{supply_id}' not found"
            )

        if current_user.role not in auth.OPERATIONAL_ACCESS_ROLES and db_requisition.in_charge_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only resubmit requisitions assigned to you"
            )

        if db_requisition.status != RequisitionStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only pending sent-back requisitions can be resubmitted. Current status: {db_requisition.status}"
            )

        latest_validation = _latest_planning_validation(supply_id, db)
        if not latest_validation or latest_validation.is_approved != "Sent Back":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This requisition is not currently sent back for edits"
            )

        expires_at = latest_validation.validation_timestamp + timedelta(hours=SEND_BACK_EDIT_WINDOW_HOURS)
        if now_ist() > expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The 12-hour edit window for this sent-back requisition has expired"
            )

        user = db.query(User).filter(User.id == requisition.in_charge_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id '{requisition.in_charge_id}' not found"
            )

        _apply_requisition_payload(db_requisition, requisition)
        db_requisition.status = RequisitionStatus.PENDING
        db_requisition.updated_at = now_ist()

        db_validation = PlanningValidation(
            supply_id=supply_id,
            validated_by=current_user.id,
            planning_remarks="Resubmitted by execution",
            is_approved="Pending",
            validation_timestamp=now_ist()
        )
        db.add(db_validation)
        db.commit()
        db.refresh(db_requisition)

        logger.info(f"Sent-back requisition resubmitted: {supply_id}")
        return _attach_latest_planning(db_requisition, db)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error resubmitting requisition {supply_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resubmit requisition"
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
    current_user: User = Depends(auth.require_roles(UserRole.PLANNING, *auth.OPERATIONAL_ACCESS_ROLES)),
):
    """
    Validate a concrete requisition by the Planning team.
    
    - Updates requisition status to 'Validated' if approved.
    - Creates a PlanningValidation record with remarks.
    - **is_approved**: Must be 'Approved', 'Sent Back', or 'Pending'
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
            validation_timestamp=now_ist()
        )
        
        # Update requisition status based on approval
        if validation.is_approved == "Approved":
            requisition.status = RequisitionStatus.VALIDATED
        elif validation.is_approved == "Sent Back":
            requisition.status = RequisitionStatus.PENDING
        # If "Pending", status stays as is
        
        requisition.updated_at = now_ist()
        
        db.add(db_validation)
        db.commit()
        db.refresh(db_validation)
        db.refresh(requisition)
        
        logger.info(f"Requisition validated: {supply_id}, Status: {validation.is_approved}")
        placer = db.query(User).filter(User.id == requisition.placed_by_id).first() if requisition.placed_by_id else None
        planning_recipients = users_by_role(db, UserRole.PLANNING, exclude_user_id=current_user.id)
        if validation.is_approved == "Approved":
            recipients = [placer] + users_by_role(db, UserRole.PRODUCTION) + planning_recipients
            subject = f"Concrete order approved: {supply_id}"
        else:
            recipients = [placer] + planning_recipients
            subject = f"Concrete order {validation.is_approved.lower()}: {supply_id}"
        send_notification(
            subject=subject,
            body=planning_decision_email(requisition, db_validation),
            recipients=recipients,
        )
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
