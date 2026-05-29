# routers/production.py - Production and dispatch endpoints
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models import (
    ConcreteRequisition, DispatchReceiptAllocation, ProductionDispatch,
    RequisitionStatus, User, UserRole
)
from . import auth
from email_service import (
    dispatch_created_email,
    return_to_plant_email,
    send_notification,
    site_acknowledgement_email,
    users_by_role,
    users_by_role_and_location,
)
from schemas import (
    DeliveryTimeUpdate, DispatchAcknowledgementUpdate, DispatchReconciliationUpdate,
    ProductionDispatchCreate, ProductionDispatchResponse, ReturnToPlantUpdate
)
from time_utils import now_ist, to_ist_naive
import logging

router = APIRouter(prefix="/production", tags=["Production"])
logger = logging.getLogger(__name__)
QUANTITY_EPSILON = 0.0001


def _allocation_total(dispatch: ProductionDispatch) -> float:
    allocations = getattr(dispatch, "receipt_allocations", None) or []
    if allocations:
        return round(sum(allocation.deposited_qty for allocation in allocations), 2)

    if dispatch.receipt_at_site_time and dispatch.release_from_site_time:
        return round(dispatch.actual_dispatched_qty, 2)

    return 0.0


def _attach_dispatch_quantities(dispatch: ProductionDispatch) -> ProductionDispatch:
    allocated_qty = _allocation_total(dispatch)
    returned_wastage_qty = round(float(dispatch.returned_wastage_qty or 0), 2)
    dispatch.pending_secondary_qty = round(float(dispatch.pending_secondary_qty or 0), 2)
    dispatch.allocated_qty = allocated_qty
    dispatch.returned_wastage_qty = returned_wastage_qty
    dispatch.remaining_qty = round(
        max(0.0, dispatch.actual_dispatched_qty - allocated_qty - returned_wastage_qty),
        2,
    )
    return dispatch


def _dispatch_fully_allocated(dispatch: ProductionDispatch) -> bool:
    _attach_dispatch_quantities(dispatch)
    return dispatch.remaining_qty <= QUANTITY_EPSILON


def _dispatch_receipt_location(dispatch: ProductionDispatch) -> str | None:
    allocations = getattr(dispatch, "receipt_allocations", None) or []
    if not allocations:
        return dispatch.receipt_location

    locations = sorted({allocation.receipt_location for allocation in allocations if allocation.receipt_location})
    if len(locations) == 1:
        return locations[0]
    return "Multiple locations"


def _sync_dispatch_receipt_summary(dispatch: ProductionDispatch) -> None:
    """Maintain legacy single-receipt columns from allocation rows for existing views."""
    allocations = getattr(dispatch, "receipt_allocations", None) or []
    if not allocations:
        return

    dispatch.delivery_time = min(allocation.receipt_at_site_time for allocation in allocations)
    dispatch.receipt_location = _dispatch_receipt_location(dispatch)

    if _dispatch_fully_allocated(dispatch):
        dispatch.receipt_at_site_time = min(allocation.receipt_at_site_time for allocation in allocations)
        dispatch.release_from_site_time = max(allocation.release_from_site_time for allocation in allocations)
    else:
        dispatch.receipt_at_site_time = None
        dispatch.release_from_site_time = None


def _dispatches_for_supply(db: Session, supply_id: str) -> list[ProductionDispatch]:
    return (
        db.query(ProductionDispatch)
        .filter(ProductionDispatch.supply_id == supply_id)
        .order_by(ProductionDispatch.dispatch_time.asc())
        .all()
    )


def _placed_by_user(db: Session, requisition: ConcreteRequisition | None) -> User | None:
    if not requisition:
        return None
    if requisition.placed_by_id:
        user = db.query(User).filter(User.id == requisition.placed_by_id).first()
        if user:
            return user
    return db.query(User).filter(User.id == requisition.in_charge_id).first()


def _execution_can_access_location(user: User, requisition: ConcreteRequisition | None) -> bool:
    if user.role != UserRole.EXECUTION or not requisition:
        return True
    assigned = {location.lower() for location in user.assigned_locations}
    if assigned:
        if requisition.location.lower() in assigned:
            return True
        return any(
            (dispatch.pending_secondary_receipt_location or "").lower() in assigned
            for dispatch in requisition.dispatch_logs
        )
    return requisition.in_charge_id == user.id or requisition.placed_by_id == user.id


def _require_dispatch_location_access(user: User, requisition: ConcreteRequisition | None) -> None:
    if user.role == UserRole.ADMIN:
        return
    if not _execution_can_access_location(user, requisition):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access dispatches for your assigned location",
        )


def _update_requisition_workflow_status(
    db: Session,
    requisition: ConcreteRequisition | None,
) -> None:
    if not requisition:
        return

    dispatches = _dispatches_for_supply(db, requisition.supply_id)
    total_dispatched_qty = sum(dispatch.actual_dispatched_qty for dispatch in dispatches)

    if total_dispatched_qty < requisition.requested_qty - QUANTITY_EPSILON:
        requisition.status = RequisitionStatus.VALIDATED
    elif not dispatches:
        requisition.status = RequisitionStatus.VALIDATED
    elif not all(_dispatch_fully_allocated(dispatch) for dispatch in dispatches):
        requisition.status = RequisitionStatus.DISPATCHED
    elif any(dispatch.return_to_plant_time is None for dispatch in dispatches):
        requisition.status = RequisitionStatus.RETURNING
    else:
        requisition.status = RequisitionStatus.RECONCILED

    requisition.updated_at = now_ist()


@router.post(
    "/dispatch",
    response_model=ProductionDispatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log concrete dispatch",
    description="Production team logs actual concrete dispatch with TM number and quantity."
)
def create_dispatch(
    dispatch: ProductionDispatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.PRODUCTION, UserRole.ADMIN)),
):
    """
    Create a production dispatch record.
    
    - **supply_id**: The requisition being dispatched
    - **tm_number**: Transit Mixer number
    - **actual_dispatched_qty**: Actual quantity dispatched in cubic meters
    - **dispatch_time**: Time of dispatch
    - **delivery_time** (optional): Time of delivery
    
    **Business Rule**: Calculates wastage = requested_qty - actual_dispatched_qty.
    Wastage % must be tracked and flagged if > 1% (ACE Limit).
    """
    try:
        # Fetch the requisition
        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == dispatch.supply_id
        ).first()
        
        if not requisition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Requisition with supply_id '{dispatch.supply_id}' not found"
            )
        
        # Check if requisition is approved or already partially dispatched.
        if requisition.status not in [RequisitionStatus.VALIDATED, RequisitionStatus.DISPATCHED]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Requisition must be Validated to dispatch. Current status: {requisition.status}"
            )
        
        existing_dispatched_qty = (
            db.query(ProductionDispatch)
            .filter(ProductionDispatch.supply_id == dispatch.supply_id)
            .with_entities(ProductionDispatch.actual_dispatched_qty)
            .all()
        )
        cumulative_dispatched_qty = sum(qty for (qty,) in existing_dispatched_qty) + dispatch.actual_dispatched_qty

        if cumulative_dispatched_qty > requisition.requested_qty:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Dispatch quantity exceeds requested quantity. "
                    f"Requested: {requisition.requested_qty:.2f}, "
                    f"already dispatched: {cumulative_dispatched_qty - dispatch.actual_dispatched_qty:.2f}, "
                    f"attempted: {dispatch.actual_dispatched_qty:.2f}"
                )
            )
        
        # Calculate current remaining quantity after this vehicle.
        wastage_qty = max(0, requisition.requested_qty - cumulative_dispatched_qty)
        wastage_percentage = (wastage_qty / requisition.requested_qty * 100) if requisition.requested_qty > 0 else 0
        
        # Create dispatch record
        db_dispatch = ProductionDispatch(
            supply_id=dispatch.supply_id,
            batching_plant_id=dispatch.batching_plant_id,
            tm_number=dispatch.tm_number,
            actual_dispatched_qty=dispatch.actual_dispatched_qty,
            dispatch_time=to_ist_naive(dispatch.dispatch_time),
            receipt_location=dispatch.receipt_location,
            delivery_time=to_ist_naive(dispatch.delivery_time),
            wastage_qty=wastage_qty
        )
        db.add(db_dispatch)
        db.flush()
        _update_requisition_workflow_status(db, requisition)
        
        # Log ACE limit violations
        if wastage_percentage > 1.0:
            logger.warning(
                f"ACE LIMIT VIOLATION: {dispatch.supply_id} has wastage of {wastage_percentage:.2f}% "
                f"(limit: 1.0%). Requested: {requisition.requested_qty}, Dispatched: {cumulative_dispatched_qty}"
            )
        
        db.commit()
        db.refresh(db_dispatch)
        
        logger.info(
            f"Dispatch created: {dispatch.supply_id}, TM: {dispatch.tm_number}, "
            f"Wastage: {wastage_percentage:.2f}%"
        )
        send_notification(
            subject=f"Concrete dispatched: {dispatch.supply_id}",
            body=dispatch_created_email(
                requisition,
                db_dispatch,
                cumulative_dispatched_qty,
                max(0, requisition.requested_qty - cumulative_dispatched_qty),
            ),
            recipients=[
                _placed_by_user(db, requisition),
                *users_by_role(db, UserRole.PLANNING),
                *users_by_role(db, UserRole.PRODUCTION, exclude_user_id=current_user.id),
            ],
        )
        return _attach_dispatch_quantities(db_dispatch)
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating dispatch: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create dispatch record"
        )


@router.get(
    "/dispatch/{supply_id}",
    response_model=list[ProductionDispatchResponse],
    summary="Get all dispatches for a requisition"
)
def get_dispatches_by_supply(
    supply_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Get all production dispatch records for a specific supply_id.
    
    Returns list of all TM dispatches for the given requisition.
    """
    try:
        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == supply_id
        ).first()
        _require_dispatch_location_access(current_user, requisition)

        dispatches = db.query(ProductionDispatch).filter(
            ProductionDispatch.supply_id == supply_id
        ).order_by(ProductionDispatch.dispatch_time.desc()).all()
        
        if not dispatches:
            logger.info(f"No dispatches found for supply_id: {supply_id}")
        
        return [_attach_dispatch_quantities(dispatch) for dispatch in dispatches]
        
    except Exception as e:
        logger.error(f"Error fetching dispatches for {supply_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch dispatch records"
        )


@router.get(
    "/",
    response_model=list[ProductionDispatchResponse],
    summary="Get all dispatches"
)
def get_all_dispatches(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Get all production dispatch records with pagination.
    
    - **skip**: Number of records to skip (default: 0)
    - **limit**: Maximum number of records to return (default: 100)
    """
    try:
        query = db.query(ProductionDispatch).join(ConcreteRequisition)
        if current_user.role == UserRole.EXECUTION:
            if current_user.assigned_locations:
                query = query.filter(
                    (ConcreteRequisition.location.in_(current_user.assigned_locations))
                    | (ProductionDispatch.pending_secondary_receipt_location.in_(current_user.assigned_locations))
                )
            else:
                query = query.filter(
                    (ConcreteRequisition.in_charge_id == current_user.id)
                    | (ConcreteRequisition.placed_by_id == current_user.id)
                )
        dispatches = query.order_by(ProductionDispatch.dispatch_time.desc()).offset(skip).limit(limit).all()
        
        return [_attach_dispatch_quantities(dispatch) for dispatch in dispatches]
        
    except Exception as e:
        logger.error(f"Error fetching all dispatches: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch dispatch records"
        )


@router.put(
    "/dispatch/{dispatch_id}/delivery",
    response_model=ProductionDispatchResponse,
    summary="Update delivery time",
    description="Update the delivery time when concrete is delivered."
)
def update_delivery_time(
    dispatch_id: str,
    delivery_update: DeliveryTimeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.PRODUCTION, UserRole.ADMIN)),
):
    """
    Update the delivery time for a dispatch record.
    
    Calculates turnaround time: delivery_time - dispatch_time
    """
    try:
        dispatch = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_id == dispatch_id
        ).first()
        
        if not dispatch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dispatch with id '{dispatch_id}' not found"
            )
        
        dispatch.delivery_time = to_ist_naive(delivery_update.delivery_time)
        dispatch.updated_at = now_ist()
        
        # Calculate turnaround time
        if dispatch.dispatch_time and dispatch.delivery_time:
            turnaround_hours = (dispatch.delivery_time - dispatch.dispatch_time).total_seconds() / 3600
            logger.info(
                f"Dispatch {dispatch_id} delivered. Turnaround time: {turnaround_hours:.2f} hours"
            )
        
        db.commit()
        db.refresh(dispatch)
        
        return _attach_dispatch_quantities(dispatch)
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating delivery time: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update delivery time"
        )


@router.put(
    "/dispatch/{dispatch_id}/acknowledge",
    response_model=ProductionDispatchResponse,
    summary="Acknowledge dispatched order at site",
    description="Record site receipt and release timings before return-to-plant reconciliation."
)
def acknowledge_dispatch(
    dispatch_id: str,
    acknowledgement: DispatchAcknowledgementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.EXECUTION, UserRole.ADMIN)),
):
    """Record site acknowledgement while keeping the requisition in dispatched state."""
    try:
        dispatch = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_id == dispatch_id
        ).first()

        if not dispatch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dispatch with id '{dispatch_id}' not found"
            )

        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == dispatch.supply_id
        ).first()
        _require_dispatch_location_access(current_user, requisition)

        _attach_dispatch_quantities(dispatch)
        remaining_qty = dispatch.remaining_qty
        if remaining_qty <= QUANTITY_EPSILON:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This dispatch has already been fully acknowledged"
            )

        has_pending_secondary = float(dispatch.pending_secondary_qty or 0) > QUANTITY_EPSILON

        if acknowledgement.details_match and has_pending_secondary:
            deposited_qty = remaining_qty
            receipt_location = (dispatch.pending_secondary_receipt_location or "").strip()
            receipt_structure_name = (dispatch.pending_secondary_receipt_structure_name or "").strip()
            receipt_structure_id = (dispatch.pending_secondary_receipt_structure_id or "").strip()
            missing_pending_fields = []
            if not receipt_location:
                missing_pending_fields.append("pending_secondary_receipt_location")
            if not receipt_structure_name:
                missing_pending_fields.append("pending_secondary_receipt_structure_name")
            if not receipt_structure_id:
                missing_pending_fields.append("pending_secondary_receipt_structure_id")
            if missing_pending_fields:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Pending secondary acknowledgement is missing: " + ", ".join(missing_pending_fields),
                )
        elif acknowledgement.details_match:
            if not requisition:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Requisition with supply_id '{dispatch.supply_id}' not found"
                )
            deposited_qty = remaining_qty
            receipt_location = requisition.location
            receipt_structure_name = requisition.structure_name
            receipt_structure_id = requisition.structure_id
        else:
            deposited_qty = round(float(acknowledgement.deposited_qty or 0), 2)
            receipt_location = (acknowledgement.receipt_location or "").strip()
            receipt_structure_name = (acknowledgement.receipt_structure_name or "").strip()
            receipt_structure_id = (acknowledgement.receipt_structure_id or "").strip()

        if deposited_qty <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Deposited quantity must be greater than zero"
            )

        if deposited_qty > remaining_qty + QUANTITY_EPSILON:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Deposited quantity exceeds remaining dispatch quantity. "
                    f"Remaining: {remaining_qty:.2f}, attempted: {deposited_qty:.2f}"
                )
            )

        remaining_after_deposit = round(max(0.0, remaining_qty - deposited_qty), 2)
        disposition = (acknowledgement.remaining_disposition or "").strip()

        if remaining_after_deposit > QUANTITY_EPSILON:
            if disposition not in ["Secondary Location", "Back to Plant"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Choose Secondary Location or Back to Plant for the remaining concrete"
                )

            if disposition == "Secondary Location":
                missing_secondary_fields = []
                if not acknowledgement.secondary_receipt_location or not acknowledgement.secondary_receipt_location.strip():
                    missing_secondary_fields.append("secondary_receipt_location")
                if not acknowledgement.secondary_receipt_structure_name or not acknowledgement.secondary_receipt_structure_name.strip():
                    missing_secondary_fields.append("secondary_receipt_structure_name")
                if not acknowledgement.secondary_receipt_structure_id or not acknowledgement.secondary_receipt_structure_id.strip():
                    missing_secondary_fields.append("secondary_receipt_structure_id")
                if missing_secondary_fields:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Secondary location requires: " + ", ".join(missing_secondary_fields)
                    )

        allocation = DispatchReceiptAllocation(
            dispatch=dispatch,
            deposited_qty=round(deposited_qty, 2),
            receipt_location=receipt_location,
            receipt_structure_name=receipt_structure_name,
            receipt_structure_id=receipt_structure_id,
            receipt_at_site_time=to_ist_naive(acknowledgement.receipt_at_site_time),
            release_from_site_time=to_ist_naive(acknowledgement.release_from_site_time),
            remarks=acknowledgement.remarks,
        )

        db.add(allocation)
        if remaining_after_deposit > QUANTITY_EPSILON and disposition == "Secondary Location":
            dispatch.remaining_concrete_disposition = "Secondary Location"
            dispatch.pending_secondary_qty = remaining_after_deposit
            dispatch.pending_secondary_receipt_location = (acknowledgement.secondary_receipt_location or "").strip()
            dispatch.pending_secondary_receipt_structure_name = (acknowledgement.secondary_receipt_structure_name or "").strip()
            dispatch.pending_secondary_receipt_structure_id = (acknowledgement.secondary_receipt_structure_id or "").strip()
        elif remaining_after_deposit > QUANTITY_EPSILON and disposition == "Back to Plant":
            dispatch.returned_wastage_qty = round(
                float(dispatch.returned_wastage_qty or 0) + remaining_after_deposit,
                2,
            )
            dispatch.remaining_concrete_disposition = "Back to Plant"
            dispatch.pending_secondary_qty = 0
            dispatch.pending_secondary_receipt_location = None
            dispatch.pending_secondary_receipt_structure_name = None
            dispatch.pending_secondary_receipt_structure_id = None
        elif remaining_after_deposit <= QUANTITY_EPSILON:
            dispatch.pending_secondary_qty = 0
            dispatch.pending_secondary_receipt_location = None
            dispatch.pending_secondary_receipt_structure_name = None
            dispatch.pending_secondary_receipt_structure_id = None

        db.flush()
        db.refresh(dispatch)

        if acknowledgement.remarks is not None:
            dispatch.remarks = acknowledgement.remarks
        dispatch.updated_at = now_ist()
        _sync_dispatch_receipt_summary(dispatch)
        _update_requisition_workflow_status(db, requisition)

        db.commit()
        db.refresh(dispatch)
        if requisition:
            db.refresh(dispatch)
            send_notification(
                subject=f"Concrete received/released at site: {dispatch.supply_id}",
                body=site_acknowledgement_email(
                    requisition,
                    dispatch,
                    deposited_qty,
                    remaining_after_deposit,
                ),
                recipients=[
                    *users_by_role(db, UserRole.PRODUCTION),
                    *users_by_role(db, UserRole.PLANNING),
                    *users_by_role_and_location(
                        db,
                        UserRole.EXECUTION,
                        requisition.location,
                        exclude_user_id=current_user.id,
                    ),
                ],
            )
        return _attach_dispatch_quantities(dispatch)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error acknowledging dispatch: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to acknowledge dispatch"
        )


@router.put(
    "/dispatch/{dispatch_id}/return-to-plant",
    response_model=ProductionDispatchResponse,
    summary="Record return-to-plant time",
    description="Record return-to-plant timing and mark the requisition as reconciled."
)
def update_return_to_plant(
    dispatch_id: str,
    return_update: ReturnToPlantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.PRODUCTION, UserRole.ADMIN)),
):
    """Close the dispatch after site acknowledgement has been captured."""
    try:
        dispatch = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_id == dispatch_id
        ).first()

        if not dispatch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dispatch with id '{dispatch_id}' not found"
            )

        if not _dispatch_fully_allocated(dispatch):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dispatch must be fully acknowledged at site before return to plant is recorded"
            )

        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == dispatch.supply_id
        ).first()

        dispatch.return_to_plant_time = to_ist_naive(return_update.return_to_plant_time)
        if return_update.remarks is not None:
            dispatch.remarks = return_update.remarks
        dispatch.updated_at = now_ist()
        db.flush()
        _update_requisition_workflow_status(db, requisition)

        db.commit()
        db.refresh(dispatch)
        if requisition:
            send_notification(
                subject=f"Concrete returned to plant: {dispatch.supply_id}",
                body=return_to_plant_email(requisition, dispatch),
                recipients=[
                    *users_by_role(db, UserRole.PLANNING),
                    *users_by_role(db, UserRole.PRODUCTION, exclude_user_id=current_user.id),
                ],
            )
        return _attach_dispatch_quantities(dispatch)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating return-to-plant time: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update return-to-plant time"
        )


@router.put(
    "/dispatch/{dispatch_id}/reconcile",
    response_model=ProductionDispatchResponse,
    summary="Reconcile dispatched order",
    description="Acknowledge site receipt, release, and return-to-plant timings."
)
def reconcile_dispatch(
    dispatch_id: str,
    reconciliation: DispatchReconciliationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.PRODUCTION, UserRole.ADMIN)),
):
    """Mark a dispatch as reconciled and update its parent requisition status."""
    try:
        dispatch = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_id == dispatch_id
        ).first()

        if not dispatch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dispatch with id '{dispatch_id}' not found"
            )

        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == dispatch.supply_id
        ).first()

        _attach_dispatch_quantities(dispatch)
        if dispatch.remaining_qty > QUANTITY_EPSILON:
            if not requisition:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Requisition with supply_id '{dispatch.supply_id}' not found"
                )
            allocation = DispatchReceiptAllocation(
                dispatch=dispatch,
                deposited_qty=dispatch.remaining_qty,
                receipt_location=requisition.location,
                receipt_structure_name=requisition.structure_name,
                receipt_structure_id=requisition.structure_id,
                receipt_at_site_time=to_ist_naive(reconciliation.receipt_at_site_time),
                release_from_site_time=to_ist_naive(reconciliation.release_from_site_time),
                remarks=reconciliation.remarks,
            )
            db.add(allocation)
            db.flush()

        dispatch.return_to_plant_time = to_ist_naive(reconciliation.return_to_plant_time)
        dispatch.remarks = reconciliation.remarks
        dispatch.updated_at = now_ist()
        _sync_dispatch_receipt_summary(dispatch)
        _update_requisition_workflow_status(db, requisition)

        db.commit()
        db.refresh(dispatch)
        return _attach_dispatch_quantities(dispatch)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error reconciling dispatch: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reconcile dispatch"
        )
