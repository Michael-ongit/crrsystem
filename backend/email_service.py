import logging
import smtplib
from email.message import EmailMessage
from typing import Iterable

from config import settings
from models import User, UserRole

logger = logging.getLogger(__name__)


def _unique_users(users: Iterable[User | None]) -> list[User]:
    seen: set[str] = set()
    recipients: list[User] = []
    for user in users:
        if not user or not user.email:
            continue
        key = user.email.lower()
        if key in seen:
            continue
        seen.add(key)
        recipients.append(user)
    return recipients


def users_by_role(db, role: UserRole, exclude_user_id: str | None = None) -> list[User]:
    query = db.query(User).filter(User.role == role)
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.all()


def users_by_role_and_location(
    db,
    role: UserRole,
    location: str,
    exclude_user_id: str | None = None,
) -> list[User]:
    location_key = location.strip().lower()
    users = users_by_role(db, role, exclude_user_id=exclude_user_id)
    if role != UserRole.EXECUTION:
        return users
    return [
        user for user in users
        if location_key in {item.lower() for item in user.assigned_locations}
    ]


def send_notification(subject: str, body: str, recipients: Iterable[User | None]) -> None:
    users = _unique_users(recipients)
    emails = [user.email for user in users]
    if not emails:
        logger.info("Notification skipped: no recipients for %s", subject)
        return

    if not settings.EMAIL_ENABLED or not settings.SMTP_HOST:
        logger.info("Notification log only: %s -> %s\n%s", subject, ", ".join(emails), body)
        return

    message = EmailMessage()
    message["From"] = settings.MAIL_FROM
    message["To"] = ", ".join(emails)
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
            if settings.SMTP_USE_TLS:
                smtp.starttls()
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)
        logger.info("Notification sent: %s -> %s", subject, ", ".join(emails))
    except Exception:
        logger.exception("Failed to send notification: %s", subject)


def requisition_summary(requisition) -> str:
    placed_by = requisition.placed_by_name or requisition.in_charge_name or requisition.selected_in_charge or "Unknown"
    return (
        f"Supply ID: {requisition.supply_id}\n"
        f"Location: {requisition.location}\n"
        f"Structure: {requisition.structure_name} ({requisition.structure_id})\n"
        f"Grade: {requisition.grade}\n"
        f"Quantity: {requisition.requested_qty:.2f} cum\n"
        f"Placed by: {placed_by}"
    )


def _line(label: str, value) -> str:
    if value is None or value == "":
        value = "-"
    return f"{label}: {value}"


def _dt(value) -> str:
    if not value:
        return "-"
    try:
        return value.strftime("%Y-%m-%d %H:%M:%S IST")
    except Exception:
        return str(value)


def requisition_details(requisition) -> str:
    placed_by = requisition.placed_by_name or "-"
    placed_by_email = requisition.placed_by_email or "-"
    return "\n".join([
        _line("Supply ID", requisition.supply_id),
        _line("RFI No.", requisition.rfi_no),
        _line("Requisition Date", requisition.requisition_date),
        _line("Location", requisition.location),
        _line("Structure Type", requisition.structure_type),
        _line("Structure Name", requisition.structure_name),
        _line("Structure ID", requisition.structure_id),
        _line("Element ID", requisition.pile_lift_id),
        _line("Concrete Grade", requisition.grade),
        _line("Drawing No.", requisition.drawing_no),
        _line("Drawing Length", requisition.drawing_length),
        _line("Drawing Diameter", requisition.drawing_diameter),
        _line("Theoretical Qty", requisition.theoretical_qty),
        _line("Actual Length", requisition.actual_length),
        _line("Actual Diameter", requisition.actual_diameter),
        _line("Actual Qty", requisition.actual_qty),
        _line("Qty Difference", requisition.qty_difference),
        _line("Difference Reason", requisition.difference_reason),
        _line("Order Quantity", f"{requisition.requested_qty:.2f} cum"),
        _line("Pour Time", requisition.pour_time),
        _line("Placement By", requisition.placement_by),
        _line("In-charge Name", requisition.in_charge_name),
        _line("Selected In-charge", requisition.selected_in_charge),
        _line("Contact Person / Engineer", requisition.contact_person),
        _line("Contact Number", requisition.contact_number),
        _line("Placed By", placed_by),
        _line("Placed By Email", placed_by_email),
        _line("Workflow Status", requisition.status),
        _line("Created At", _dt(requisition.created_at)),
        _line("Updated At", _dt(requisition.updated_at)),
    ])


def dispatch_details(dispatch) -> str:
    lines = [
        _line("Dispatch ID", dispatch.dispatch_id),
        _line("Supply ID", dispatch.supply_id),
        _line("Batching Plant ID", dispatch.batching_plant_id),
        _line("Vehicle Number", dispatch.tm_number),
        _line("Quantity Dispatched", f"{dispatch.actual_dispatched_qty:.2f} cum"),
        _line("Dispatch Time", _dt(dispatch.dispatch_time)),
        _line("Destination / Receipt Location", dispatch.receipt_location),
        _line("Delivery Time", _dt(dispatch.delivery_time)),
        _line("Receipt at Site", _dt(dispatch.receipt_at_site_time)),
        _line("Release from Site", _dt(dispatch.release_from_site_time)),
        _line("Return to Plant", _dt(dispatch.return_to_plant_time)),
        _line("Returned / Back-to-Plant Qty", f"{float(dispatch.returned_wastage_qty or 0):.2f} cum"),
        _line("Remaining Concrete Disposition", dispatch.remaining_concrete_disposition),
        _line("Pending Secondary Qty", f"{float(dispatch.pending_secondary_qty or 0):.2f} cum"),
        _line("Pending Secondary Location", dispatch.pending_secondary_receipt_location),
        _line("Pending Secondary Structure", dispatch.pending_secondary_receipt_structure_name),
        _line("Pending Secondary Structure ID", dispatch.pending_secondary_receipt_structure_id),
        _line("Remarks", dispatch.remarks),
    ]

    allocations = getattr(dispatch, "receipt_allocations", None) or []
    if allocations:
        lines.append("")
        lines.append("Receipt Allocations:")
        for index, allocation in enumerate(allocations, start=1):
            lines.extend([
                _line(f"Allocation {index} Qty", f"{allocation.deposited_qty:.2f} cum"),
                _line(f"Allocation {index} Location", allocation.receipt_location),
                _line(f"Allocation {index} Structure", allocation.receipt_structure_name),
                _line(f"Allocation {index} Structure ID", allocation.receipt_structure_id),
                _line(f"Allocation {index} Receipt at Site", _dt(allocation.receipt_at_site_time)),
                _line(f"Allocation {index} Release from Site", _dt(allocation.release_from_site_time)),
                _line(f"Allocation {index} Remarks", allocation.remarks),
            ])
    return "\n".join(lines)


def order_placed_email(requisition) -> str:
    return (
        "A new concrete order has been placed and is awaiting Planning review.\n\n"
        "Order Details\n"
        "-------------\n"
        f"{requisition_details(requisition)}"
    )


def planning_decision_email(requisition, validation) -> str:
    return (
        "Planning has recorded a decision for a concrete order.\n\n"
        "Planning Decision\n"
        "-----------------\n"
        f"{_line('Decision', validation.is_approved)}\n"
        f"{_line('Planning Remarks', validation.planning_remarks)}\n"
        f"{_line('Decision Time', _dt(validation.validation_timestamp))}\n"
        f"{_line('Validated By User ID', validation.validated_by)}\n\n"
        "Order Details\n"
        "-------------\n"
        f"{requisition_details(requisition)}"
    )


def dispatch_created_email(requisition, dispatch, cumulative_dispatched_qty: float, remaining_order_qty: float) -> str:
    return (
        "Production has dispatched concrete for an approved order.\n\n"
        "Dispatch Details\n"
        "----------------\n"
        f"{dispatch_details(dispatch)}\n"
        f"{_line('Cumulative Dispatched Qty', f'{cumulative_dispatched_qty:.2f} cum')}\n"
        f"{_line('Remaining Order Qty', f'{remaining_order_qty:.2f} cum')}\n\n"
        "Order Details\n"
        "-------------\n"
        f"{requisition_details(requisition)}"
    )


def site_acknowledgement_email(requisition, dispatch, deposited_qty: float, remaining_after_deposit: float) -> str:
    return (
        "Execution has recorded receipt/release details at site.\n\n"
        "Site Receipt / Release\n"
        "----------------------\n"
        f"{dispatch_details(dispatch)}\n"
        f"{_line('Qty Deposited in This Action', f'{deposited_qty:.2f} cum')}\n"
        f"{_line('Remaining After This Action', f'{remaining_after_deposit:.2f} cum')}\n\n"
        "Order Details\n"
        "-------------\n"
        f"{requisition_details(requisition)}"
    )


def return_to_plant_email(requisition, dispatch) -> str:
    return (
        "Production has recorded vehicle return to plant.\n\n"
        "Return Details\n"
        "--------------\n"
        f"{dispatch_details(dispatch)}\n\n"
        "Order Details\n"
        "-------------\n"
        f"{requisition_details(requisition)}"
    )
