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
import logging
import re
import zipfile
import xml.etree.ElementTree as ET

from sqlalchemy.orm import Session

from database import SessionLocal
from models import RequisitionElement

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


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    count = seed_reference_data()
    print(f"Seeded {count} requisition reference rows")
