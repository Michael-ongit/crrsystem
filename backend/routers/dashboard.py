# routers/dashboard.py - Analytics and reconciliation endpoints
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta
from database import get_db
from models import (
    ConcreteRequisition, ProductionDispatch, RequisitionStatus, User, UserRole
)
from . import auth
from schemas import (
    DashboardSummary, WastageRecord, TurnaroundTimeRecord
)
from config import settings
import logging

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
logger = logging.getLogger(__name__)


@router.get(
    "/summary",
    response_model=DashboardSummary,
    summary="Get dashboard summary",
    description="Comprehensive dashboard summary with wastage tracking and KPI metrics."
)
def get_dashboard_summary(
    days: int = Query(30, description="Number of days to analyze"),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    """
    Get comprehensive dashboard summary.
    
    - Tracks ACE Limit (1% wastage threshold) violations
    - Calculates daily wastage percentages
    - Provides TM turnaround time statistics
    - **days**: Analyze data from the past N days (default: 30)
    
    **Critical KPI**: Wastage % = (Requested - Dispatched) / Requested * 100
    Violations flagged when > 1%
    """
    try:
        # Define date range
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        # Count requisitions by status
        total_requisitions = db.query(func.count(ConcreteRequisition.supply_id)).scalar() or 0
        pending_count = db.query(func.count(ConcreteRequisition.supply_id)).filter(
            ConcreteRequisition.status == RequisitionStatus.PENDING
        ).scalar() or 0
        validated_count = db.query(func.count(ConcreteRequisition.supply_id)).filter(
            ConcreteRequisition.status == RequisitionStatus.VALIDATED
        ).scalar() or 0
        dispatched_count = db.query(func.count(ConcreteRequisition.supply_id)).filter(
            ConcreteRequisition.status.in_([RequisitionStatus.DISPATCHED, RequisitionStatus.RETURNING])
        ).scalar() or 0
        reconciled_count = db.query(func.count(ConcreteRequisition.supply_id)).filter(
            ConcreteRequisition.status == RequisitionStatus.RECONCILED
        ).scalar() or 0
        
        # Get requisitions and their dispatches within date range
        requisitions_with_dispatch = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.req_date >= cutoff_date
        ).all()
        
        # Calculate wastage records
        wastage_records = []
        total_wastage_percentage = 0.0
        violation_count = 0
        
        for req in requisitions_with_dispatch:
            # Get all dispatches for this requisition
            dispatches = db.query(ProductionDispatch).filter(
                ProductionDispatch.supply_id == req.supply_id
            ).all()
            
            if dispatches:
                total_dispatched = sum(d.actual_dispatched_qty for d in dispatches)
                wastage = max(0, req.requested_qty - total_dispatched)
                wastage_pct = (wastage / req.requested_qty * 100) if req.requested_qty > 0 else 0
                
                exceeds_ace = wastage_pct > settings.ACE_LIMIT_PERCENT
                if exceeds_ace:
                    violation_count += 1
                
                total_wastage_percentage += wastage_pct
                
                tm_numbers = [d.tm_number for d in dispatches]
                
                wastage_records.append(
                    WastageRecord(
                        supply_id=req.supply_id,
                        requested_qty=req.requested_qty,
                        actual_dispatched_qty=total_dispatched,
                        wastage_qty=wastage,
                        wastage_percentage=round(wastage_pct, 2),
                        exceeds_ace_limit=exceeds_ace,
                        dispatch_date=min(d.dispatch_time for d in dispatches),
                        tm_numbers=tm_numbers
                    )
                )
        
        # Calculate average wastage
        avg_wastage = (total_wastage_percentage / len(wastage_records)) if wastage_records else 0.0
        
        # Get turnaround time records
        turnaround_records = []
        dispatches_with_times = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_time >= cutoff_date
        ).all()
        
        for dispatch in dispatches_with_times:
            turnaround_hours = None
            status_str = "In Transit"
            
            if dispatch.delivery_time:
                turnaround_hours = (dispatch.delivery_time - dispatch.dispatch_time).total_seconds() / 3600
                status_str = "Delivered"
            
            turnaround_records.append(
                TurnaroundTimeRecord(
                    tm_number=dispatch.tm_number,
                    dispatch_time=dispatch.dispatch_time,
                    delivery_time=dispatch.delivery_time,
                    turnaround_hours=turnaround_hours,
                    status=status_str
                )
            )
        
        logger.info(
            f"Dashboard summary generated: Total={total_requisitions}, "
            f"Violations={violation_count}, Avg Wastage={avg_wastage:.2f}%"
        )
        
        return DashboardSummary(
            total_requisitions=total_requisitions,
            pending_count=pending_count,
            validated_count=validated_count,
            dispatched_count=dispatched_count,
            reconciled_count=reconciled_count,
            average_wastage_percentage=round(avg_wastage, 2),
            violation_count=violation_count,
            wastage_records=wastage_records,
            turnaround_records=turnaround_records
        )
        
    except Exception as e:
        logger.error(f"Error generating dashboard summary: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate dashboard summary"
        )


@router.get(
    "/wastage",
    response_model=list[WastageRecord],
    summary="Get wastage records",
    description="Get detailed wastage records for ACE limit analysis."
)
def get_wastage_records(
    days: int = Query(30, description="Number of days to analyze"),
    exceeds_limit_only: bool = Query(False, description="Only show violations"),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    """
    Get wastage records with optional filtering.
    
    - **exceeds_limit_only**: If True, return only records exceeding 1% ACE limit
    """
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        requisitions = db.query(ConcreteRequisition).filter(
            ConcreteRequisition.req_date >= cutoff_date
        ).all()
        
        wastage_records = []
        
        for req in requisitions:
            dispatches = db.query(ProductionDispatch).filter(
                ProductionDispatch.supply_id == req.supply_id
            ).all()
            
            if dispatches:
                total_dispatched = sum(d.actual_dispatched_qty for d in dispatches)
                wastage = max(0, req.requested_qty - total_dispatched)
                wastage_pct = (wastage / req.requested_qty * 100) if req.requested_qty > 0 else 0
                
                exceeds_ace = wastage_pct > settings.ACE_LIMIT_PERCENT
                
                # Apply filter
                if exceeds_limit_only and not exceeds_ace:
                    continue
                
                tm_numbers = [d.tm_number for d in dispatches]
                
                wastage_records.append(
                    WastageRecord(
                        supply_id=req.supply_id,
                        requested_qty=req.requested_qty,
                        actual_dispatched_qty=total_dispatched,
                        wastage_qty=wastage,
                        wastage_percentage=round(wastage_pct, 2),
                        exceeds_ace_limit=exceeds_ace,
                        dispatch_date=min(d.dispatch_time for d in dispatches),
                        tm_numbers=tm_numbers
                    )
                )
        
        # Sort by wastage percentage descending
        wastage_records.sort(key=lambda x: x.wastage_percentage, reverse=True)
        
        return wastage_records
        
    except Exception as e:
        logger.error(f"Error fetching wastage records: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch wastage records"
        )


@router.get(
    "/turnaround",
    response_model=list[TurnaroundTimeRecord],
    summary="Get TM turnaround times",
    description="Get Transit Mixer turnaround time statistics."
)
def get_turnaround_times(
    days: int = Query(30, description="Number of days to analyze"),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    """
    Get TM turnaround time records for performance analysis.
    
    Turnaround = delivery_time - dispatch_time (in hours)
    """
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        dispatches = db.query(ProductionDispatch).filter(
            ProductionDispatch.dispatch_time >= cutoff_date
        ).order_by(ProductionDispatch.dispatch_time.desc()).all()
        
        turnaround_records = []
        
        for dispatch in dispatches:
            turnaround_hours = None
            status_str = "In Transit"
            
            if dispatch.delivery_time:
                turnaround_hours = round(
                    (dispatch.delivery_time - dispatch.dispatch_time).total_seconds() / 3600,
                    2
                )
                status_str = "Delivered"
            
            turnaround_records.append(
                TurnaroundTimeRecord(
                    tm_number=dispatch.tm_number,
                    dispatch_time=dispatch.dispatch_time,
                    delivery_time=dispatch.delivery_time,
                    turnaround_hours=turnaround_hours,
                    status=status_str
                )
            )
        
        return turnaround_records
        
    except Exception as e:
        logger.error(f"Error fetching turnaround times: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch turnaround times"
        )
