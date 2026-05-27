from datetime import datetime, timedelta, timezone


IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def now_ist() -> datetime:
    """Return a timezone-naive IST timestamp for database storage."""
    return datetime.now(IST).replace(tzinfo=None)


def to_ist_naive(value: datetime | None) -> datetime | None:
    """Normalize aware datetimes to IST, preserving naive values as local IST."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=None)
    return value.astimezone(IST).replace(tzinfo=None)
