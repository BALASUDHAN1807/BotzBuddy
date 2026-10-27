"""Learning Twin: per-session learner state, mastery and XP tracking."""

from __future__ import annotations

import os
from typing import Any

from .registry import get_all_concepts, get_profile
from .utils import iso_now, now_ms, rand_id, to_number

RANKS = [
    {"minXp": 0, "name": "Explorer", "emoji": "🌱"},
    {"minXp": 30, "name": "Builder", "emoji": "🔧"},
    {"minXp": 70, "name": "Experimenter", "emoji": "🧪"},
    {"minXp": 120, "name": "Explainer", "emoji": "🧠"},
    {"minXp": 180, "name": "Creator", "emoji": "🚀"},
]


def get_rank_for_xp(xp: float) -> dict:
    current = RANKS[0]
    for r in RANKS:
        if xp >= r["minXp"]:
            current = r
    return current


def get_mastery_level(score: float | None) -> dict:
    score = score or 0
    if score < 40:
        return {"level": "Foundation", "description": "Simpler pacing & concrete hints"}
    if score <= 75:
        return {"level": "Developing", "description": "Standard hands-on discovery"}
    return {"level": "Ready", "description": "Advanced deep explanations & fast-track unlocked"}


def _default_general_stem() -> bool:
    return os.environ.get("GENERAL_STEM_MODE") != "off"


class LearningTwin:
    def __init__(
        self,
        session_id: str | None = None,
        context: str | None = "home",
        profile_id: str | None = None,
        age: Any = 9,
        interests: list[str] | None = None,
        knowledge: str | None = "new",
        known_concepts: list[str] | None = None,
        language: str | None = "en",
        character_id: str | None = None,
        short_mode: bool = False,
        wants_depth: bool = False,
        explorer: bool = False,
        general_stem_mode: Any = None,
    ) -> None:
        profile = get_profile(profile_id) if profile_id else None

        self.session_id = session_id or f"sess_{now_ms()}_{rand_id(5)}"
        self.context = context or "home"  # home | kit | class | workshop
        self.profile_id = profile_id or (profile["id"] if profile else None)
        self.age = profile["age"] if profile else to_number(age, 9)
        self.age_band = "young" if self.age < 10 else "older"
        self.language = (profile and profile.get("language")) or language or "en"

        self.general_stem_mode = general_stem_mode if general_stem_mode is not None else _default_general_stem()

        if isinstance(interests, list) and interests:
            self.interests = list(interests)
        elif profile and profile.get("interests"):
            self.interests = list(profile["interests"])
        else:
            self.interests = ["general"]

        self.short_mode = bool(profile.get("shortMode")) if profile else bool(short_mode)
        self.wants_depth = bool(profile.get("wantsDepth")) if profile else bool(wants_depth)
        self.explorer = bool(profile.get("explorer")) if profile else bool(explorer)

        self.mastery: dict[str, float] = {c["id"]: 0 for c in get_all_concepts()}

        if profile and profile.get("knownConcepts"):
            initial_known = profile["knownConcepts"]
        else:
            initial_known = known_concepts if isinstance(known_concepts, list) else []

        if knowledge in ("basics", "challenge") and "simple_circuit" in self.mastery:
            self.mastery["simple_circuit"] = 80
        for kc in initial_known:
            if kc in self.mastery:
                self.mastery[kc] = 80

        self.misconceptions_found: list[dict] = []
        self.hint_level = 0  # 0 hint, 1 example, 2 demonstration, 3 explanation
        self.current_character = character_id or "wavy"
        self.current_concept: str | None = None
        self.stage = "idle"  # idle|build|experiment|observe|explain|create|complete|teamup|memory_boost
        self.xp = 0
        self.rank = RANKS[0]["name"]
        self.rank_emoji = RANKS[0]["emoji"]

        self.signals = {"say": 0, "choose": 0, "build": 0, "explain": 0, "confidence": 0}
        self.curiosity_domains: dict[str, int] = {}

        self.concept_confidence: dict[str, str] = {}
        self.memory_boost_queue: list[str] = []
        self.memory_boosts_count = 0
        self.last_memory_boost_turn = 0
        self.turns_count = 0
        self.active_team_up: dict | None = None
        self.active_boost_concept: str | None = None

        self.decision_log: list[dict] = []
        self.created_at = now_ms()
        self.last_active_at = now_ms()

    # ---------------------------------------------------------------- signals
    def record_curiosity_domain(self, domain: str | None) -> None:
        if domain:
            self.curiosity_domains[domain] = self.curiosity_domains.get(domain, 0) + 1

    def record_signal(self, kind: str) -> None:
        if kind in self.signals:
            self.signals[kind] += 1
        self.turns_count += 1
        self.last_active_at = now_ms()

    def touch(self) -> None:
        self.last_active_at = now_ms()

    def set_concept_confidence(self, concept_id: str | None, level: str) -> None:
        self.record_signal("confidence")
        if concept_id:
            self.concept_confidence[concept_id] = level

    # ----------------------------------------------------------- memory boost
    def queue_memory_boost(self, concept_id: str | None) -> None:
        if concept_id and concept_id not in self.memory_boost_queue:
            self.memory_boost_queue.append(concept_id)

    def get_next_memory_boost(self) -> str | None:
        if self.memory_boost_queue and self.turns_count - self.last_memory_boost_turn >= 3:
            nxt = self.memory_boost_queue.pop(0)
            self.last_memory_boost_turn = self.turns_count
            self.memory_boosts_count += 1
            return nxt
        return None

    # ------------------------------------------------------- mastery and XP
    def add_decision(self, decision: dict) -> None:
        self.decision_log.insert(0, {"timestamp": iso_now(), **decision})
        if len(self.decision_log) > 10:
            self.decision_log.pop()

    def adjust_mastery(self, concept_id: str | None, delta: float) -> float:
        if not concept_id:
            return 0
        old = self.mastery.get(concept_id, 0)
        new = max(0, min(100, old + delta))
        self.mastery[concept_id] = new
        return new

    def add_xp(self, amount: int) -> dict:
        old_rank = get_rank_for_xp(self.xp)
        self.xp += amount
        new_rank = get_rank_for_xp(self.xp)
        self.rank = new_rank["name"]
        self.rank_emoji = new_rank["emoji"]
        return {
            "xpGained": amount,
            "totalXp": self.xp,
            "rankUp": new_rank["name"] != old_rank["name"] and self.xp >= new_rank["minXp"],
            "oldRank": old_rank["name"],
            "newRank": new_rank["name"],
            "rankEmoji": new_rank["emoji"],
        }

    def record_misconception(self, concept_id: str, misconception_id: str, fix_text: str) -> None:
        exists = any(
            m["conceptId"] == concept_id and m["misconceptionId"] == misconception_id
            for m in self.misconceptions_found
        )
        if not exists:
            self.misconceptions_found.append(
                {
                    "conceptId": concept_id,
                    "misconceptionId": misconception_id,
                    "fixText": fix_text,
                    "detectedAt": iso_now(),
                }
            )
        self.adjust_mastery(concept_id, -5)

    def next_hint_level(self) -> int:
        self.hint_level = min(3, self.hint_level + 1)
        if self.current_concept:
            self.adjust_mastery(self.current_concept, -3)
        return self.hint_level

    def reset_hint_level(self) -> None:
        self.hint_level = 0

    # -------------------------------------------------------------- summaries
    def _current_mastery(self) -> float:
        return self.mastery.get(self.current_concept, 0) if self.current_concept else 0

    def to_summary(self) -> dict:
        current = self._current_mastery()
        needs_help = self.hint_level >= 2 or (
            self.stage != "idle" and current < 40 and len(self.misconceptions_found) > 0
        )
        return {
            "sessionId": self.session_id,
            "context": self.context,
            "profileId": self.profile_id,
            "age": self.age,
            "ageBand": self.age_band,
            "interests": self.interests,
            "language": self.language,
            "shortMode": self.short_mode,
            "wantsDepth": self.wants_depth,
            "explorer": self.explorer,
            "currentCharacter": self.current_character,
            "currentConcept": self.current_concept,
            "stage": self.stage,
            "xp": self.xp,
            "rank": self.rank,
            "rankEmoji": self.rank_emoji,
            "hintLevel": self.hint_level,
            "needsHelp": needs_help,
            "memoryBoostsCount": self.memory_boosts_count,
            "conceptConfidence": dict(self.concept_confidence),
            "signals": dict(self.signals),
            "curiosityDomains": dict(self.curiosity_domains),
            "generalStemMode": self.general_stem_mode,
            "mastery": dict(self.mastery),
            "misconceptionsCount": len(self.misconceptions_found),
            "misconceptions": list(self.misconceptions_found),
            "recentDecisions": list(self.decision_log),
        }

    def to_teacher_summary(self, index: int = 1) -> dict:
        current = self._current_mastery()
        needs_help = self.hint_level >= 2 or current < 40 or len(self.misconceptions_found) > 0
        latest = self.misconceptions_found[-1]["fixText"] if self.misconceptions_found else None
        return {
            "sessionId": self.session_id,
            "learnerLabel": f"Learner {index}",
            "context": self.context,
            "ageBand": self.age_band,
            "currentConcept": self.current_concept,
            "currentCharacter": self.current_character,
            "mastery": current,
            "stage": self.stage,
            "rank": self.rank,
            "rankEmoji": self.rank_emoji,
            "misconceptionsCount": len(self.misconceptions_found),
            "latestMisconception": latest,
            "needsHelp": needs_help,
            "lastActiveAt": self.last_active_at,
        }
