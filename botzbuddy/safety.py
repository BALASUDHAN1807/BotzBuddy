"""Child protection, personal privacy and electrical safety checks."""

from __future__ import annotations

import re

UNSAFE_PATTERNS = [
    re.compile(
        r"\b(kill|suicide|die|hurt myself|self harm|weapon|gun|bomb|knife|drugs|poison|alcohol|abuse|hate|violence|nsfw|sex|porn)\b",
        re.I,
    ),
    re.compile(r"\b(danger|dangerous substance|explosive|fire hazard|burn down)\b", re.I),
]

PERSONAL_INFO_PATTERNS = [
    re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),  # email
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"),  # US phone
    re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\d{10}\b"),  # 10-digit phone
    re.compile(
        r"\b(my name is|my full name is|i live at|my address is|my password is|my school is|credit card|my phone number is)\b",
        re.I,
    ),
]

MAINS_ELECTRICITY_PATTERNS = [
    re.compile(
        r"\b(wall socket|wall plug|mains|power outlet|220v|110v|plug into the wall|ac power|high voltage|electrical outlet)\b",
        re.I,
    )
]


def check_safety(text: str | None) -> dict | None:
    if not text or not isinstance(text, str):
        return None
    t = text.strip()

    if any(p.search(t) for p in MAINS_ELECTRICITY_PATTERNS):
        return {
            "safe": False,
            "category": "mains_electricity",
            "message": "⚡ Safety first! Only use small batteries (like AA or 3V coin cells) for our robot circuits, never wall sockets or mains power.",
        }

    if any(p.search(t) for p in PERSONAL_INFO_PATTERNS):
        return {
            "safe": False,
            "category": "personal_info",
            "message": "🛡️ No need to share personal details like names, addresses, or phone numbers! Let's keep exploring science together safely.",
        }

    if any(p.search(t) for p in UNSAFE_PATTERNS):
        return {
            "safe": False,
            "category": "unsafe_topic",
            "message": "🌸 That sounds like something important to talk about with a trusted grown-up or teacher. Let's get back to making fun robots!",
        }

    return {"safe": True}
