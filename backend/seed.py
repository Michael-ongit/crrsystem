"""Seed master requisition reference data from the project slip workbook.

The preferred blueprint input is ``Concrete_Requisition_Slip.xlsx - Sheet1.csv``.
That CSV is not always present in local project checkouts, so this module first
uses the CSV+pandas path when available and otherwise falls back to parsing the
checked-in ``Concrete_Requisition_Slip.xlsx`` file directly with the Python
standard library. Both paths produce the same normalized records for the
``requisition_elements`` table.
"""

from __future__ import annotations

from pathlib import Path
from datetime import datetime, timedelta
import logging
import re
import zipfile
import xml.etree.ElementTree as ET

from sqlalchemy.orm import Session
from time_utils import now_ist

from database import SessionLocal
from models import (
    ConcreteRequisition,
    DispatchReceiptAllocation,
    PlanningValidation,
    ProductionDispatch,
    RequisitionElement,
    RequisitionStatus,
    User,
    UserRole,
)

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CSV_SOURCE = PROJECT_ROOT / "Concrete_Requisition_Slip.xlsx - Sheet1.csv"
XLSX_SOURCE = PROJECT_ROOT / "Concrete_Requisition_Slip.xlsx"
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _normalize_text(value: object) -> str | None:
    """Return clean string content, treating empty spreadsheet values as None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _expand_element_ids(value: str | None) -> list[str | None]:
    """Expand compact spreadsheet ranges such as P1 to P9 into atomic options."""
    if not value:
        return [None]

    normalized = " ".join(value.split())
    if normalized.lower().replace(" ", "") == "left/right":
        return ["Left", "Right"]

    expanded: list[str] = []
    range_pattern = re.compile(
        r"\b([A-Za-z]+)(\d+)([A-Za-z]?)\s+to\s+([A-Za-z]+)(\d+)([A-Za-z]?)\b"
    )
    for prefix_start, start, suffix_start, prefix_end, end, suffix_end in range_pattern.findall(normalized):
        if prefix_start.upper() != prefix_end.upper() or suffix_start.lower() != suffix_end.lower():
            continue
        start_number = int(start)
        end_number = int(end)
        if start_number > end_number or end_number - start_number > 500:
            continue
        expanded.extend(
            f"{prefix_start.upper()}{number}{suffix_start.lower()}"
            for number in range(start_number, end_number + 1)
        )

    if expanded:
        return list(dict.fromkeys(expanded))

    return [normalized]


def _records_from_csv(path: Path) -> list[dict[str, str | None]]:
    """Read the optional CSV export with pandas using the requested cleaning flow."""
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("pandas is required to read the CSV seed source") from exc

    df = pd.read_csv(path, header=1)
    df = df.dropna(axis=1, how="all")
    df = df.rename(columns={"Pile ID/Lift ID/Girder ID/Segment ID": "Element_ID"})
    for column in ["Location", "Structure Type", "Structure Name"]:
        if column in df.columns:
            df[column] = df[column].ffill()

    required_columns = ["Location", "Structure Type", "Structure Name", "Structure ID"]
    df = df.dropna(subset=["Location", "Structure ID"])

    records: list[dict[str, str | None]] = []
    for _, row in df.iterrows():
        base = {
            "location": _normalize_text(row.get("Location")),
            "structure_type": _normalize_text(row.get("Structure Type")),
            "structure_name": _normalize_text(row.get("Structure Name")),
            "structure_id": _normalize_text(row.get("Structure ID")),
        }
        if not all(base[column] for column in ["location", "structure_type", "structure_name", "structure_id"]):
            continue
        for element_id in _expand_element_ids(_normalize_text(row.get("Element_ID"))):
            records.append({**base, "element_id": element_id})

    logger.info("Loaded %s reference records from CSV %s", len(records), path)
    return records


def _shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS))
        for item in root.findall("a:si", XLSX_NS)
    ]


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str | None:
    value = cell.find("a:v", XLSX_NS)
    if value is None or value.text is None:
        return None
    if cell.attrib.get("t") == "s":
        return _normalize_text(shared_strings[int(value.text)])
    return _normalize_text(value.text)


def _records_from_xlsx(path: Path) -> list[dict[str, str | None]]:
    """Parse the workbook directly when the CSV export is not available."""
    with zipfile.ZipFile(path) as workbook:
        shared_strings = _shared_strings(workbook)
        worksheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))

    rows: dict[int, dict[str, str | None]] = {}
    cell_pattern = re.compile(r"([A-Z]+)(\d+)")
    for cell in worksheet.findall(".//a:c", XLSX_NS):
        match = cell_pattern.match(cell.attrib["r"])
        if not match:
            continue
        column, row_number = match.group(1), int(match.group(2))
        if column not in {"B", "C", "D", "E", "F"} or row_number < 3:
            continue
        rows.setdefault(row_number, {})[column] = _cell_value(cell, shared_strings)

    records: list[dict[str, str | None]] = []
    last_location = last_type = last_name = None
    for row_number in sorted(rows):
        row = rows[row_number]
        last_location = row.get("B") or last_location
        last_type = row.get("C") or last_type
        last_name = row.get("D") or last_name
        structure_id = row.get("E")
        if not last_location or not structure_id:
            continue
        for element_id in _expand_element_ids(row.get("F")):
            records.append(
                {
                    "location": last_location,
                    "structure_type": last_type or "",
                    "structure_name": last_name or "",
                    "structure_id": structure_id,
                    "element_id": element_id,
                }
            )

    logger.info("Loaded %s reference records from workbook %s", len(records), path)
    return records


def load_reference_records() -> list[dict[str, str | None]]:
    """Load normalized seed records from the best available source file."""
    if CSV_SOURCE.exists():
        try:
            return _records_from_csv(CSV_SOURCE)
        except Exception as exc:
            logger.warning("CSV seed path failed; falling back to workbook parse: %s", exc)

    if XLSX_SOURCE.exists():
        return _records_from_xlsx(XLSX_SOURCE)

    logger.warning("No requisition reference seed source found")
    return []


def seed_reference_data(db: Session | None = None, clear_existing: bool = True) -> int:
    """
    Seed ``requisition_elements`` using a clear-and-insert pipeline.

    The function accepts an optional active session for tests and scripts. When
    called without one, it manages its own session and transaction boundaries.
    """
    owns_session = db is None
    session = db or SessionLocal()
    try:
        records = load_reference_records()
        if not records:
            return 0

        if clear_existing:
            session.query(RequisitionElement).delete()

        seen: set[tuple[str, str, str, str, str | None]] = set()
        elements: list[RequisitionElement] = []
        for record in records:
            key = (
                record["location"] or "",
                record["structure_type"] or "",
                record["structure_name"] or "",
                record["structure_id"] or "",
                record["element_id"],
            )
            if key in seen:
                continue
            seen.add(key)
            elements.append(RequisitionElement(**record))

        session.add_all(elements)
        session.commit()
        logger.info("Seeded %s requisition reference rows", len(elements))
        return len(elements)
    except Exception:
        session.rollback()
        logger.exception("Failed to seed requisition reference data")
        raise
    finally:
        if owns_session:
            session.close()


def _demo_users(session: Session) -> dict[str, User]:
    """Create or reuse predictable users for local workflow simulation."""
    from routers.auth import hash_password

    users = {
        "execution": ("Execution Demo", "execution.demo@mvdp.local", UserRole.EXECUTION),
        "planning": ("Planning Demo", "planning.demo@mvdp.local", UserRole.PLANNING),
        "production": ("Production Demo", "production.demo@mvdp.local", UserRole.PRODUCTION),
        "admin": ("Admin Demo", "admin.demo@mvdp.local", UserRole.ADMIN),
    }
    created: dict[str, User] = {}
    for key, (name, email, role) in users.items():
        user = session.query(User).filter(User.email == email).one_or_none()
        if user is None:
            user = User(
                name=name,
                email=email,
                role=role,
                password_hash=hash_password("DemoPass123"),
                is_email_verified=True,
            )
            session.add(user)
            session.flush()
        created[key] = user
    return created


def _demo_reference_rows(session: Session, count: int) -> list[RequisitionElement]:
    rows = (
        session.query(RequisitionElement)
        .filter(RequisitionElement.structure_id.isnot(None))
        .order_by(RequisitionElement.id.asc())
        .limit(count)
        .all()
    )
    if rows:
        return rows

    fallback = [
        RequisitionElement(
            location="Gorai IC",
            structure_type="Permanent",
            structure_name="Pile",
            structure_id=f"VGP{number}",
            element_id=f"P{number}",
        )
        for number in range(1, count + 1)
    ]
    session.add_all(fallback)
    session.flush()
    return fallback


def _add_validation(
    session: Session,
    supply_id: str,
    user_id: str,
    decision: str,
    remarks: str,
    at_time: datetime,
) -> None:
    session.add(
        PlanningValidation(
            supply_id=supply_id,
            validated_by=user_id,
            planning_remarks=remarks,
            is_approved=decision,
            validation_timestamp=at_time,
        )
    )


def _add_dispatch(
    session: Session,
    supply_id: str,
    plant: str,
    tm: str,
    qty: float,
    dispatch_time: datetime,
    receipt_location: str,
    allocations: list[dict[str, object]] | None = None,
    returned_at: datetime | None = None,
) -> ProductionDispatch:
    dispatch = ProductionDispatch(
        supply_id=supply_id,
        batching_plant_id=plant,
        tm_number=tm,
        actual_dispatched_qty=qty,
        dispatch_time=dispatch_time,
        receipt_location=receipt_location,
        wastage_qty=0,
    )
    session.add(dispatch)
    session.flush()

    for allocation_data in allocations or []:
        allocation = DispatchReceiptAllocation(
            dispatch_id=dispatch.dispatch_id,
            deposited_qty=float(allocation_data["qty"]),
            receipt_location=str(allocation_data["location"]),
            receipt_structure_name=str(allocation_data["structure_name"]),
            receipt_structure_id=str(allocation_data["structure_id"]),
            receipt_at_site_time=allocation_data["receipt_at"],
            release_from_site_time=allocation_data["release_at"],
            remarks=str(allocation_data.get("remarks") or ""),
        )
        session.add(allocation)

    if allocations:
        dispatch.delivery_time = min(item["receipt_at"] for item in allocations)
        allocated_qty = sum(float(item["qty"]) for item in allocations)
        if allocated_qty >= qty:
            dispatch.receipt_at_site_time = min(item["receipt_at"] for item in allocations)
            dispatch.release_from_site_time = max(item["release_at"] for item in allocations)
        dispatch.remarks = "Demo receipt allocation"

    if returned_at:
        dispatch.return_to_plant_time = returned_at

    return dispatch


def seed_sample_data(db: Session | None = None) -> int:
    """
    Seed 12 realistic demo requisitions across the complete workflow.

    The seed is intentionally idempotent at the database level by only inserting
    when called from ``init_db`` against an empty requisition table.
    """
    owns_session = db is None
    session = db or SessionLocal()
    try:
        users = _demo_users(session)
        refs = _demo_reference_rows(session, 12)
        now = now_ist().replace(microsecond=0)
        grades = ["M-45", "M-50", "M-40", "M-30"]
        placements = ["Boom placer", "Line pump", "Direct chute", "Concrete bucket"]
        stage_data = [
            ("Pending", RequisitionStatus.PENDING, None, []),
            ("Sent Back", RequisitionStatus.PENDING, "Sent Back", []),
            ("Approved A", RequisitionStatus.VALIDATED, "Approved", []),
            ("Approved B", RequisitionStatus.VALIDATED, "Approved", []),
            ("Partial Dispatch", RequisitionStatus.VALIDATED, "Approved", [{"qty_ratio": 0.55, "allocated": []}]),
            ("Awaiting Ack", RequisitionStatus.DISPATCHED, "Approved", [{"qty_ratio": 1.0, "allocated": []}]),
            ("Partial Ack", RequisitionStatus.DISPATCHED, "Approved", [{"qty_ratio": 1.0, "allocated": [0.45]}]),
            ("Return Ready", RequisitionStatus.RETURNING, "Approved", [{"qty_ratio": 1.0, "allocated": [1.0]}]),
            ("Two TM Return", RequisitionStatus.RETURNING, "Approved", [{"qty_ratio": 0.55, "allocated": [1.0], "returned": True}, {"qty_ratio": 0.45, "allocated": [1.0]}]),
            ("Reconciled A", RequisitionStatus.RECONCILED, "Approved", [{"qty_ratio": 1.0, "allocated": [1.0], "returned": True}]),
            ("Split Used", RequisitionStatus.RECONCILED, "Approved", [{"qty_ratio": 1.0, "allocated": [0.58, 0.42], "returned": True}]),
            ("Reconciled B", RequisitionStatus.RECONCILED, "Approved", [{"qty_ratio": 1.0, "allocated": [1.0], "returned": True}]),
        ]

        for index, (label, req_status, decision, dispatch_specs) in enumerate(stage_data, start=1):
            ref = refs[index - 1]
            requested_qty = round(8.0 + (index % 5) * 2.5, 2)
            created_at = now - timedelta(days=14 - index, hours=index)
            supply_id = f"MVDP-DEMO-{index:03d}"
            requisition = ConcreteRequisition(
                supply_id=supply_id,
                req_date=created_at,
                rfi_no=f"RFI-DEMO-{index:03d}",
                requisition_date=created_at.date().isoformat(),
                location=ref.location,
                in_charge_id=users["execution"].id,
                structure_type=ref.structure_type,
                structure_name=ref.structure_name,
                structure_id=ref.structure_id,
                pile_lift_id=ref.element_id,
                grade=grades[index % len(grades)],
                drawing_no=f"DWG-MVDP-{index:03d}",
                drawing_length=round(10 + index * 0.75, 2),
                drawing_diameter=round(1.2 + (index % 3) * 0.1, 2),
                theoretical_qty=requested_qty,
                actual_length=round(10.1 + index * 0.7, 2),
                actual_diameter=round(1.2 + (index % 2) * 0.1, 2),
                actual_qty=round(requested_qty - 0.15, 2),
                qty_difference=0.15,
                difference_reason="Demo variation for site measurement",
                requested_qty=requested_qty,
                pour_time=f"{8 + index % 8:02d}:30",
                placement_by=placements[index % len(placements)],
                contact_person=f"Site Engineer {index}",
                contact_number=f"90000010{index:02d}",
                status=req_status,
                created_at=created_at,
                updated_at=created_at,
            )
            session.add(requisition)
            session.flush()

            if decision:
                remarks = (
                    "Demo sent back: clarify pour sequence and quantity"
                    if decision == "Sent Back"
                    else f"Demo approved for {label.lower()} workflow"
                )
                _add_validation(
                    session,
                    supply_id,
                    users["planning"].id,
                    decision,
                    remarks,
                    created_at + timedelta(hours=2),
                )

            for dispatch_index, spec in enumerate(dispatch_specs, start=1):
                qty = round(requested_qty * float(spec.get("qty_ratio", 1.0)), 2)
                dispatch_time = created_at + timedelta(hours=5 + dispatch_index)
                allocation_payloads = []
                for allocation_index, allocation_qty in enumerate(spec.get("allocated", []), start=1):
                    deposited_qty = round(qty * float(allocation_qty), 2)
                    target_ref = refs[(index + allocation_index) % len(refs)]
                    receipt_at = dispatch_time + timedelta(minutes=45 + allocation_index * 10)
                    allocation_payloads.append(
                        {
                            "qty": deposited_qty,
                            "location": target_ref.location,
                            "structure_name": target_ref.structure_name,
                            "structure_id": target_ref.structure_id,
                            "receipt_at": receipt_at,
                            "release_at": receipt_at + timedelta(minutes=35),
                            "remarks": "Demo concrete deposited at site",
                        }
                    )
                returned_at = (
                    dispatch_time + timedelta(hours=3)
                    if spec.get("returned")
                    else None
                )
                _add_dispatch(
                    session,
                    supply_id,
                    plant=f"BP-{1 + index % 3}",
                    tm=f"TM-DEMO-{index:02d}-{dispatch_index}",
                    qty=qty,
                    dispatch_time=dispatch_time,
                    receipt_location=ref.location,
                    allocations=allocation_payloads,
                    returned_at=returned_at,
                )

        session.commit()
        return len(stage_data)
    except Exception:
        session.rollback()
        logger.exception("Failed to seed sample data")
        raise
    finally:
        if owns_session:
            session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    count = seed_reference_data()
    print(f"Seeded {count} requisition reference rows")
