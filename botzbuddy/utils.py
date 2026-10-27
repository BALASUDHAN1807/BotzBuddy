"""Small shared helpers."""

from __future__ import annotations

import random
import string
import time
from datetime import datetime, timezone
from typing import Any

_BASE36 = string.digits + string.ascii_lowercase


def now_ms() -> int:
    """Current time in milliseconds since the epoch."""
    return int(time.time() * 1000)


def iso_now() -> str:
    """ISO-8601 UTC timestamp with milliseconds, e.g. 2026-10-26T17:36:00.123Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def rand_id(length: int) -> str:
    """Random lowercase base-36 string."""
    return "".join(random.choice(_BASE36) for _ in range(length))


def to_number(value: Any, default: float) -> float:
    """Loose numeric conversion: returns ``default`` for missing, zero or invalid values."""
    if value is None or isinstance(value, bool):
        return default
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    if num != num or num == 0:  # NaN or 0
        return default
    return int(num) if num.is_integer() else num


def parse_index(value: Any, prefix: str, default: int | None = None) -> int | None:
    """Parse the trailing integer of a value like ``check_ans_2``."""
    if not isinstance(value, str):
        return default
    try:
        return int(value.replace(prefix, "", 1))
    except ValueError:
        return default
