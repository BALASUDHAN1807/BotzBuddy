"""Session service shared by the Streamlit UI and the REST API.

Sessions live in one process-wide store, so the Teacher View sees every learner
connected to the same server.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from .brain import initialize_session, process_message
from .llm import photo_check_vision
from .registry import get_all_characters, get_all_concepts, get_character, get_concept
from .twin import LearningTwin
from .utils import now_ms

log = logging.getLogger("botzbuddy.service")

SESSION_TTL_MS = 2 * 60 * 60 * 1000
FALLBACK_PHOTO_TEXT = "I can't see photos right now, but tell me what you built!"

sessions: dict[str, LearningTwin] = {}
_lock = threading.RLock()


def stem_flag(value: Any) -> bool | None:
    """Normalise a general-STEM setting ('on'/'off'/bool) to a bool, or None if unset."""
    if value is None:
        return None
    return value == "on" or value is True


def get_twin(session_id: str | None) -> LearningTwin | None:
    if not session_id:
        return None
    with _lock:
        return sessions.get(session_id)


def _get_or_create(session_id: str | None, general_stem: bool | None = None) -> LearningTwin:
    with _lock:
        twin = sessions.get(session_id or "")
        if twin is None:  # expired or unknown: start fresh under the same id
            twin = LearningTwin(session_id=session_id, general_stem_mode=general_stem)
            sessions[twin.session_id] = twin
        elif general_stem is not None:
            twin.general_stem_mode = general_stem
        return twin


def cleanup_old_sessions() -> int:
    cutoff = now_ms() - SESSION_TTL_MS
    with _lock:
        stale = [sid for sid, twin in sessions.items() if twin.last_active_at < cutoff]
        for sid in stale:
            sessions.pop(sid, None)
    return len(stale)


async def create_session(
    *,
    context: str | None = "home",
    profile_id: str | None = None,
    age: Any = 9,
    interests: list[str] | None = None,
    knowledge: str | None = "new",
    language: str | None = "en",
    character_id: str | None = None,
    product_slug: str | None = None,
    short_mode: bool = False,
    wants_depth: bool = False,
    explorer: bool = False,
    general_stem: bool | None = None,
) -> dict:
    twin = LearningTwin(
        context=context or "home",
        profile_id=profile_id,
        age=age if age is not None else 9,
        interests=interests,
        knowledge=knowledge or "new",
        language=language or "en",
        character_id=character_id,
        short_mode=bool(short_mode),
        wants_depth=bool(wants_depth),
        explorer=bool(explorer),
        general_stem_mode=general_stem,
    )
    with _lock:
        sessions[twin.session_id] = twin
    result = await initialize_session(twin=twin, character_slug=product_slug or character_id)
    return {"sessionId": twin.session_id, **result}


async def chat(session_id: str, text: str = "", action: dict | None = None, general_stem: bool | None = None) -> dict:
    twin = _get_or_create(session_id, general_stem)
    return await process_message(twin=twin, text=text or "", action=action)


async def photo_check(session_id: str | None, image_base64: str, concept_id: str | None = None) -> dict:
    twin = _get_or_create(session_id)
    all_chars = get_all_characters()
    character = (
        get_character(twin.current_character or "quacky")
        or next((c for c in all_chars if c.get("status") == "verified"), None)
        or all_chars[0]
    )
    concept = get_concept(concept_id or twin.current_concept) or get_all_concepts()[0]

    provider = "rule-based"
    try:
        feedback = await photo_check_vision(
            image_base64=image_base64 or "", concept=concept, character=character, age=twin.age or 9
        )
        provider = "gemini"
    except Exception as err:  # noqa: BLE001
        log.warning("[PhotoCheck] Vision unavailable, using fallback: %s", err)
        feedback = FALLBACK_PHOTO_TEXT

    if provider == "gemini":
        twin.record_signal("build")
        twin.adjust_mastery(concept["id"], 10)
        twin.add_xp(10)

    return {
        "ok": True,
        "feedback": feedback,
        "provider": provider,
        "character": {"id": character["id"], "name": character["name"], "emoji": character["emoji"]},
        "xpAwarded": 10 if provider == "gemini" else 0,
        "state": twin.to_summary(),
    }


def teacher_sessions(context: str | None = None) -> list[dict]:
    with _lock:
        twins = list(sessions.values())
    rows = []
    for twin in twins:
        if not context or context == "all" or twin.context == context:
            rows.append(twin.to_teacher_summary(len(rows) + 1))
    return rows
