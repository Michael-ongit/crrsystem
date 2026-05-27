import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import (
    ConcreteRequisition,
    DropdownOption,
    PlanningValidation,
    ProductionDispatch,
    RegistrationInvite,
    RequisitionElement,
    RequisitionStatus,
    User,
    UserRole,
)
from schemas import (
    DropdownOptionCreate,
    DropdownOptionResponse,
    DropdownOptionUpdate,
    RegistrationInviteCreate,
    RegistrationInviteResponse,
    RegistrationInviteUpdate,
    RequisitionElementCreate,
    RequisitionElementResponse,
    RequisitionElementUpdate,
    UserResponse,
    UserUpdate,
)
from time_utils import now_ist
from . import auth

router = APIRouter(prefix="/admin", tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/summary", summary="Usage-focused admin summary")
def get_admin_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    dispatches = db.query(ProductionDispatch).all()
    pending_acknowledgement = sum(
        1
        for dispatch in dispatches
        if not dispatch.return_to_plant_time
        and (
            not dispatch.receipt_allocations
            or sum(allocation.deposited_qty for allocation in dispatch.receipt_allocations)
            + float(dispatch.returned_wastage_qty or 0)
            < dispatch.actual_dispatched_qty
        )
    )
    pending_return = sum(
        1
        for dispatch in dispatches
        if dispatch.receipt_allocations and not dispatch.return_to_plant_time
    )

    return {
        "users": db.query(User).count(),
        "allowed_emails": db.query(RegistrationInvite).count(),
        "active_allowed_emails": db.query(RegistrationInvite).filter(RegistrationInvite.is_active.is_(True)).count(),
        "dropdown_options": db.query(DropdownOption).count(),
        "reference_rows": db.query(RequisitionElement).count(),
        "pending_requisitions": db.query(ConcreteRequisition).filter(ConcreteRequisition.status == RequisitionStatus.PENDING).count(),
        "approved_requisitions": db.query(ConcreteRequisition).filter(ConcreteRequisition.status == RequisitionStatus.VALIDATED).count(),
        "dispatches_pending_acknowledgement": pending_acknowledgement,
        "dispatches_pending_return": pending_return,
        "planning_decisions": db.query(PlanningValidation).count(),
    }


@router.get("/registration-emails", response_model=list[RegistrationInviteResponse])
def list_registration_invites(
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    query = db.query(RegistrationInvite)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                RegistrationInvite.email.ilike(pattern),
                RegistrationInvite.name_hint.ilike(pattern),
            )
        )
    return query.order_by(RegistrationInvite.created_at.desc()).all()


@router.post(
    "/registration-emails",
    response_model=RegistrationInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_registration_invite(
    payload: RegistrationInviteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    existing = db.query(RegistrationInvite).filter(RegistrationInvite.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This email is already on the registration list")

    invite = RegistrationInvite(
        email=payload.email,
        name_hint=payload.name_hint,
        role=UserRole(payload.role.value),
        is_active=payload.is_active,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


@router.patch("/registration-emails/{invite_id}", response_model=RegistrationInviteResponse)
def update_registration_invite(
    invite_id: str,
    payload: RegistrationInviteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    invite = db.query(RegistrationInvite).filter(RegistrationInvite.invite_id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration email not found")

    if payload.name_hint is not None:
        invite.name_hint = payload.name_hint
    if payload.role is not None:
        invite.role = UserRole(payload.role.value)
        if invite.registered_user_id:
            user = db.query(User).filter(User.id == invite.registered_user_id).first()
            if user:
                user.role = UserRole(payload.role.value)
    if payload.is_active is not None:
        invite.is_active = payload.is_active
    invite.updated_at = now_ist()

    db.commit()
    db.refresh(invite)
    return invite


@router.delete("/registration-emails/{invite_id}")
def delete_registration_invite(
    invite_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    invite = db.query(RegistrationInvite).filter(RegistrationInvite.invite_id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration email not found")
    db.delete(invite)
    db.commit()
    return {"message": "Registration email removed"}


@router.get("/users", response_model=list[UserResponse])
def admin_list_users(
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    query = db.query(User)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.filter(or_(User.name.ilike(pattern), User.email.ilike(pattern)))
    return query.order_by(User.created_at.desc()).all()


@router.patch("/users/{user_id}", response_model=UserResponse)
def admin_update_user(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if payload.email and payload.email != user.email:
        existing_user = db.query(User).filter(User.email == payload.email, User.id != user_id).first()
        if existing_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
        user.email = payload.email
    if payload.name is not None:
        user.name = payload.name
    if payload.role is not None:
        user.role = UserRole(payload.role.value)
    if payload.is_email_verified is not None:
        user.is_email_verified = payload.is_email_verified
    if payload.password:
        user.password_hash = auth.hash_password(payload.password)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own admin account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        db.delete(user)
        db.commit()
        return {"message": "User removed"}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is linked to existing project records. Change their role or deactivate access instead.",
        ) from exc


@router.get("/dropdown-options", response_model=list[DropdownOptionResponse])
def list_dropdown_options(
    category: str | None = None,
    search: str | None = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    query = db.query(DropdownOption)
    if category:
        query = query.filter(DropdownOption.category == category)
    if active_only:
        query = query.filter(DropdownOption.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(DropdownOption.value.ilike(pattern), DropdownOption.label.ilike(pattern)))
    return query.order_by(DropdownOption.category.asc(), DropdownOption.sort_order.asc(), DropdownOption.value.asc()).all()


@router.post("/dropdown-options", response_model=DropdownOptionResponse, status_code=status.HTTP_201_CREATED)
def create_dropdown_option(
    payload: DropdownOptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    existing = (
        db.query(DropdownOption)
        .filter(DropdownOption.category == payload.category, DropdownOption.value == payload.value)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This dropdown value already exists")

    option = DropdownOption(
        category=payload.category,
        value=payload.value,
        label=payload.label or payload.value,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(option)
    db.commit()
    db.refresh(option)
    return option


@router.patch("/dropdown-options/{option_id}", response_model=DropdownOptionResponse)
def update_dropdown_option(
    option_id: str,
    payload: DropdownOptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    option = db.query(DropdownOption).filter(DropdownOption.option_id == option_id).first()
    if not option:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dropdown option not found")

    if payload.value is not None:
        option.value = payload.value
    if payload.label is not None:
        option.label = payload.label or option.value
    if payload.is_active is not None:
        option.is_active = payload.is_active
    if payload.sort_order is not None:
        option.sort_order = payload.sort_order
    option.updated_at = now_ist()

    db.commit()
    db.refresh(option)
    return option


@router.delete("/dropdown-options/{option_id}")
def delete_dropdown_option(
    option_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    option = db.query(DropdownOption).filter(DropdownOption.option_id == option_id).first()
    if not option:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dropdown option not found")
    db.delete(option)
    db.commit()
    return {"message": "Dropdown option removed"}


@router.get("/reference-elements", response_model=list[RequisitionElementResponse])
def list_reference_elements(
    search: str | None = None,
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    query = db.query(RequisitionElement)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                RequisitionElement.location.ilike(pattern),
                RequisitionElement.structure_type.ilike(pattern),
                RequisitionElement.structure_name.ilike(pattern),
                RequisitionElement.structure_id.ilike(pattern),
                RequisitionElement.element_id.ilike(pattern),
            )
        )
    return query.order_by(RequisitionElement.location.asc(), RequisitionElement.structure_name.asc()).limit(limit).all()


@router.post("/reference-elements", response_model=RequisitionElementResponse, status_code=status.HTTP_201_CREATED)
def create_reference_element(
    payload: RequisitionElementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    element = RequisitionElement(**payload.model_dump())
    db.add(element)
    db.commit()
    db.refresh(element)
    return element


@router.patch("/reference-elements/{element_id}", response_model=RequisitionElementResponse)
def update_reference_element(
    element_id: int,
    payload: RequisitionElementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    element = db.query(RequisitionElement).filter(RequisitionElement.id == element_id).first()
    if not element:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference option not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(element, key, value)
    db.commit()
    db.refresh(element)
    return element


@router.delete("/reference-elements/{element_id}")
def delete_reference_element(
    element_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN)),
):
    element = db.query(RequisitionElement).filter(RequisitionElement.id == element_id).first()
    if not element:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference option not found")
    db.delete(element)
    db.commit()
    return {"message": "Reference option removed"}
