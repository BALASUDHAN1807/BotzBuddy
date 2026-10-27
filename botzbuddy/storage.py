"""Curiosity Jar storage: in-memory, with optional MongoDB persistence.

Set MONGODB_URI (and ``pip install pymongo``) to also persist questions to MongoDB.
"""

from __future__ import annotations

import logging
import re
import threading
from collections import Counter
from datetime import datetime, timezone

from .config import env
from .utils import iso_now, now_ms, rand_id

log = logging.getLogger("botzbuddy.storage")

curiosity_jar: list[dict] = []
_jar_lock = threading.Lock()
_mongo_collection = None


def _connect_mongo() -> None:
    global _mongo_collection
    uri = env("MONGODB_URI")
    if not uri:
        return
    try:
        from pymongo import MongoClient  # optional dependency

        client = MongoClient(uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
        db = client.get_default_database(default="botzbuddy")
        _mongo_collection = db["curiosityjars"]
        log.info("[MongoDB] Connected successfully for persistence.")
    except Exception as err:  # noqa: BLE001
        _mongo_collection = None
        log.warning("[MongoDB] Not available, continuing in-memory: %s", err)


_connect_mongo()


def sanitize_question(raw: str | None) -> str:
    """Strip personal info (emails, phone numbers, long digit runs) and cap length."""
    if not raw or not isinstance(raw, str):
        return ""
    cleaned = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "", raw)
    cleaned = re.sub(r"\b(?:\+?\d{1,3}[-.\s]?)?\d{10}\b", "", cleaned)
    cleaned = re.sub(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b", "", cleaned)
    cleaned = re.sub(r"\b\d{4,}\b", "", cleaned)  # keep small numbers like 7 x 8
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > 200:
        cleaned = cleaned[:200].strip()
    return cleaned


def _save_to_mongo(doc: dict) -> None:
    try:
        _mongo_collection.insert_one(doc)  # type: ignore[union-attr]
    except Exception as err:  # noqa: BLE001
        log.warning("[MongoDB] Save error: %s", err)


def add_curiosity_question(
    *,
    question: str,
    character_asked: str = "wavy",
    age_band: str = "young",
    context: str = "home",
    tier: str = "unsupported_fact",
    domain: str = "other",
) -> dict | None:
    sanitized = sanitize_question(question)
    if not sanitized or len(sanitized) < 3:
        return None

    entry = {
        "id": f"q_{now_ms()}_{rand_id(4)}",
        "question": sanitized,
        "characterAsked": character_asked or "wavy",
        "ageBand": age_band or "young",
        "context": context or "home",
        "tier": tier or "unsupported_fact",
        "domain": domain or "other",
        "timestamp": iso_now(),
    }

    with _jar_lock:
        curiosity_jar.insert(0, entry)
        if len(curiosity_jar) > 50:
            curiosity_jar.pop()

    if _mongo_collection is not None:
        doc = {k: v for k, v in entry.items() if k != "id"}
        doc["timestamp"] = datetime.now(timezone.utc)
        threading.Thread(target=_save_to_mongo, args=(doc,), daemon=True).start()

    return entry


STOP_WORDS = {
    "what", "is", "the", "how", "why", "can", "does", "and", "a", "to", "in",
    "of", "for", "you", "your", "about", "tell", "me",
}


def get_curiosity_jar_summary() -> dict:
    by_character: dict[str, int] = {}
    keyword_counts: Counter[str] = Counter()

    with _jar_lock:
        items = list(curiosity_jar)

    for item in items:
        by_character[item["characterAsked"]] = by_character.get(item["characterAsked"], 0) + 1
        words = re.sub(r"[^a-z\s]", "", item["question"].lower()).split()
        for w in words:
            if len(w) > 2 and w not in STOP_WORDS:
                keyword_counts[w] += 1

    top_keywords = [{"word": w, "count": c} for w, c in keyword_counts.most_common(10)]

    return {
        "total": len(items),
        "byCharacter": by_character,
        "topKeywords": top_keywords,
        "recentQuestions": items[:20],
        "storageMode": "mongodb" if _mongo_collection is not None else "in-memory",
    }
