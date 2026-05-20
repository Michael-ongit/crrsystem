# routers/production.py - Production and dispatch endpoints
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from database import get_db
from models import (
    ProductionDispatch, ConcreteRequisition, RequisitionStatus, User, UserRole
)
from . import auth
from schemas import (
    DeliveryTimeUpdate, DispatchAcknowledgementUpdate, DispatchReconciliationUpdate,
    ProductionDispatchCreate, ProductionDispatchResponse, ReturnToPlantUpdate
)
import logging

router = APIRouter(prefix="/production", tags=["Production"])
logger = logging.getLogger(__name__)


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
            dispatch_time=dispatch.dispatch_time,
            receipt_location=dispatch.receipt_location,
            delivery_time=dispatch.delivery_time,
            wastage_qty=wastage_qty
        )
        
        # Keep partially dispatched requisitions approved until the full quantity is dispatched.
        requisition.status = (
            RequisitionStatus.DISPATCHED
            if cumulative_dispatched_qty >= requisition.requested_qty
            else RequisitionStatus.VALIDATED
        )
        requisition.updated_at = datetime.utcnow()
        
        # Log ACE limit violations
        if wastage_percentage > 1.0:
            logger.warning(
                f"ACE LIMIT VIOLATION: {dispatch.supply_id} has wastage of {wastage_percentage:.2f}% "
                f"(limit: 1.0%). Requested: {requisition.requested_qty}, Dispatched: {cumulative_dispatched_qty}"
            )
        
        db.add(db_dispatch)
        db.commit()
        db.refresh(db_dispatch)
        
        logger.info(
            f"Dispatch created: {dispatch.supply_id}, TM: {dispatch.tm_number}, "
            f"Wastage: {wastage_percentage:.2f}%"
        )
        return db_dispatch
        
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
    db: Session = Depends(get_db)
):
    """
    Get all production dispatch records for a specific supply_id.
    
    Returns list of all TM dispatches for the given requisition.
    """
    try:
        dispatches = db.query(ProductionDispatch).filter(
            ProductionDispatch.supply_id == supply_id
        ).order_by(ProductionDispatch.dispatch_time.desc()).all()
        
        if not dispatches:
            logger.info(f"No dispatches found for supply_id: {supply_id}")
        
        return dispatches
        
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
    db: Session = Depends(get_db)
):
    """
    Get all production dispatch records with pagination.
    
    - **skip**: Number of records to skip (default: 0)
    - **limit**: Maximum number of records to return (default: 100)
    """
    try:
        dispatches = db.query(ProductionDispatch).order_by(
            ProductionDispatch.dispatch_time.desc()
        ).offset(skip).limit(limit).all()
        
        return dispatches
        
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
        
        dispatch.delivery_time = delivery_update.delivery_time
        dispatch.updated_at = datetime.utcnow()
        
        # Calculate turnaround time
        if dispatch.dispatch_time and dispatch.delivery_time:
            turnaround_hours = (dispatch.delivery_time - dispatch.dispatch_time).total_seconds() / 3600
            logger.info(
                f"Dispatch {dispatch_id} delivered. Turnaround time: {turnaround_hours:.2f} hours"
            )
        
        db.commit()
        db.refresh(dispatch)
        
        return dispatch
        
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
    current_user: User = Depends(auth.require_roles(UserRole.PRODUCTION, UserRole.ADMIN)),
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

        dispatch.receipt_at_site_time = acknowledgement.receipt_at_site_time
        dispatch.release_from_site_time = acknowledgement.release_from_site_time
        dispatch.delivery_time = acknowledgement.receipt_at_site_time
        dispatch.remarks = acknowledgement.remarks
        dispatch.updated_at = datetime.utcnow()

        if requisition:
            total_dispatched_qty = sum(
                qty for (qty,) in db.query(ProductionDispatch.actual_dispatched_qty)
                .filter(ProductionDispatch.supply_id == dispatch.supply_id)
                .all()
            )
            requisition.status = (
                RequisitionStatus.RETURNING
                if total_dispatched_qty >= requisition.requested_qty
                else RequisitionStatus.VALIDATED
            )
            requisition.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(dispatch)
        return dispatch

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

        if not dispatch.receipt_at_site_time or not dispatch.release_from_site_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dispatch must be acknowledged at site before return to plant is recorded"
            )

        requisition = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.supply_id == dispatch.supply_id
        ).first()

        dispatch.return_to_plant_time = return_update.return_to_plant_time
        if return_update.remarks is not None:
            dispatch.remarks = return_update.remarks
        dispatch.updated_at = datetime.utcnow()
        db.flush()

        if requisition:
            total_dispatched_qty = sum(
                qty for (qty,) in db.query(ProductionDispatch.actual_dispatched_qty)
                .filter(ProductionDispatch.supply_id == dispatch.supply_id)
                .all()
            )
            pending_returns = (
                db.query(ProductionDispatch)
                .filter(
                    ProductionDispatch.supply_id == dispatch.supply_id,
                    ProductionDispatch.return_to_plant_time.is_(None),
                )
                .count()
            )
            requisition.status = (
                RequisitionStatus.RECONCILED
                if total_dispatched_qty >= requisition.requested_qty and pending_returns == 0
                else RequisitionStatus.RETURNING
                if total_dispatched_qty >= requisition.requested_qty
                else RequisitionStatus.VALIDATED
            )
            requisition.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(dispatch)
        return dispatch

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

        dispatch.receipt_at_site_time = reconciliation.receipt_at_site_time
        dispatch.release_from_site_time = reconciliation.release_from_site_time
        dispatch.return_to_plant_time = reconciliation.return_to_plant_time
        dispatch.remarks = reconciliation.remarks
        dispatch.delivery_time = reconciliation.receipt_at_site_time
        dispatch.updated_at = datetime.utcnow()

        if requisition:
            requisition.status = RequisitionStatus.RECONCILED
            requisition.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(dispatch)
        return dispatch

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error reconciling dispatch: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reconcile dispatch"
        )
