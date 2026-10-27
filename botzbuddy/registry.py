"""Characters, concepts and profiles registry with hot-reload support."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from .config import DATA_DIR

log = logging.getLogger("botzbuddy.registry")

CHAR_DIR = DATA_DIR / "characters"
CONCEPTS_FILE = DATA_DIR / "concepts.json"
PROFILES_FILE = DATA_DIR / "profiles.json"

_lock = threading.RLock()
_characters: dict[str, dict[str, Any]] = {}
_concepts: dict[str, dict[str, Any]] = {}
_profiles: dict[str, dict[str, Any]] = {}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_concepts() -> None:
    if not CONCEPTS_FILE.exists():
        log.warning("Concepts file not found at %s", CONCEPTS_FILE)
        return
    try:
        parsed = _read_json(CONCEPTS_FILE)
    except Exception as err:  # noqa: BLE001
        log.error("Error loading concepts: %s", err)
        return
    _concepts.clear()
    for c in parsed:
        if isinstance(c, dict) and c.get("id"):
            _concepts[c["id"]] = c
    log.info("Loaded %d concepts.", len(_concepts))


def _load_profiles() -> None:
    if not PROFILES_FILE.exists():
        log.warning("Profiles file not found at %s", PROFILES_FILE)
        return
    try:
        parsed = _read_json(PROFILES_FILE)
    except Exception as err:  # noqa: BLE001
        log.error("Error loading profiles: %s", err)
        return
    _profiles.clear()
    for p in parsed:
        if isinstance(p, dict) and p.get("id"):
            _profiles[p["id"]] = p
    log.info("Loaded %d profiles.", len(_profiles))


def _load_characters() -> None:
    if not CHAR_DIR.exists():
        log.warning("Characters dir not found at %s", CHAR_DIR)
        return
    _characters.clear()
    for file in sorted(CHAR_DIR.glob("*.json")):
        try:
            char = _read_json(file)
        except Exception as err:  # noqa: BLE001
            log.warning("Invalid JSON in %s: %s. Skipping file.", file.name, err)
            continue
        if not isinstance(char, dict) or not char.get("id") or not char.get("name"):
            log.warning("Skipping invalid character in %s: missing id or name", file.name)
            continue

        valid_concepts = []
        for cid in char.get("concepts") or []:
            if cid in _concepts:
                valid_concepts.append(cid)
            else:
                log.warning("Unknown concept '%s' in character '%s' (%s) ignored.", cid, char["id"], file.name)
        char["concepts"] = valid_concepts

        if char.get("status") == "verified" and not valid_concepts:
            log.warning("Character '%s' marked verified has 0 valid concepts. Downgrading to behaviour_only.", char["id"])
            char["status"] = "behaviour_only"

        if not isinstance(char.get("facts"), list):
            char["facts"] = []
        if not isinstance(char.get("interestTags"), list):
            char["interestTags"] = []
        char.setdefault("avatarUrl", None)
        char.setdefault("productSlug", None)
        char.setdefault("kitUrl", None)
        char["emoji"] = char.get("emoji") or "🤖"
        char["color"] = char.get("color") or "#FFB13B"
        char["role"] = char.get("role") or "companion"
        char["group"] = char.get("group") or "A"
        char["voiceStyle"] = char.get("voiceStyle") or "Friendly and encouraging"
        char["voiceStyleNote"] = char.get("voiceStyleNote") or (
            "voice style and emoji are team presentation choices, not Funobotz facts"
        )
        _characters[char["id"]] = char
    log.info("Loaded %d characters.", len(_characters))


def reload_all() -> None:
    with _lock:
        _load_concepts()
        _load_profiles()
        _load_characters()


def data_fingerprint() -> tuple:
    """Modification-time snapshot of the data folder, used for hot reload."""
    items = []
    if DATA_DIR.exists():
        for path in sorted(DATA_DIR.rglob("*.json")):
            try:
                items.append((str(path), path.stat().st_mtime_ns))
            except OSError:
                continue
    return tuple(items)


# ----------------------------------------------------------------- accessors
def get_character(char_id: str | None) -> dict[str, Any] | None:
    if not char_id or not isinstance(char_id, str):
        return None
    return _characters.get(char_id.lower())


def get_all_characters() -> list[dict[str, Any]]:
    return list(_characters.values())


def get_concept(concept_id: str | None) -> dict[str, Any] | None:
    if not concept_id:
        return None
    return _concepts.get(concept_id)


def get_all_concepts() -> list[dict[str, Any]]:
    return sorted(_concepts.values(), key=lambda c: c.get("order") or 99)


def get_profile(profile_id: str | None) -> dict[str, Any] | None:
    if not profile_id:
        return None
    return _profiles.get(profile_id)


def get_all_profiles() -> list[dict[str, Any]]:
    return list(_profiles.values())


reload_all()
