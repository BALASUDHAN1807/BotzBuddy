"""Age-adaptive explainer for general STEM questions (OpenAI -> Gemini -> Groq -> safe template)."""

from __future__ import annotations

import logging
import re
from typing import Any

from .classifier import VALID_SKILLS
from .llm import call_explainer_llm
from .registry import get_all_characters
from .utils import to_number

log = logging.getLogger("botzbuddy.explainer")

SAFE_TEMPLATE = (
    "That's a great science question! I'm not sure enough to explain it well right now. "
    "I've saved it in the Curiosity Jar. Want to explore a Funobotz topic instead?"
)


def determine_age_level(age: Any, wants_depth: bool = False) -> str:
    num = to_number(age, 9)
    if wants_depth:
        if num <= 8:
            num = 10
        elif num <= 11:
            num = 13
    if num <= 8:
        return "little"
    if num <= 11:
        return "middle"
    return "senior"


def get_max_sentence_count(level: str, short_mode: bool = False) -> int:
    if level == "little":
        return 2 if short_mode else 3
    if level == "middle":
        return 2 if short_mode else 4
    return 3 if short_mode else 5


def get_level_rules(level: str, short_mode: bool = False) -> str:
    n = get_max_sentence_count(level, short_mode)
    if level == "little":
        return (
            f'Level "little" (Ages 6-8): Maximum {n} sentences. Maximum 12 words per sentence. Everyday words only. '
            "One friendly comparison to daily life. No technical terms (or at most one, explained simply in plain words). "
            "Playful and warm tone."
        )
    if level == "middle":
        return (
            f'Level "middle" (Ages 9-11): Maximum {n} sentences. Clear cause -> effect explanation. Up to 2 key terms '
            "explained in brackets, like 'fermentation (good bacteria transforming milk)'. One simple 'try this at home "
            "safely' idea when safe."
        )
    return (
        f'Level "senior" (Ages 12-14): Maximum {n} sentences. Use correct scientific terms (e.g., lactic acid bacteria, '
        "protein coagulation, Rayleigh scattering, aerodynamics). Explain the underlying physical or biological "
        "mechanism. Include one real-world engineering or scientific application. Include one 'think deeper' inquiry question."
    )


def split_sentences(text: str | None) -> list[str]:
    if not text:
        return []
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


_ALIASES = re.compile(r"\b(quacky|tiko|tolly|petalo|cuby|emoti|wavy|zen|spike|bolt|kutty)\b", re.I)


def contains_character_names(text: str | None) -> bool:
    if not text:
        return False
    lower = text.lower()
    for c in get_all_characters():
        if c["name"].lower() in lower or c["id"].lower() in lower:
            return True
    return bool(_ALIASES.search(lower))


def enforce_guardrails(data: Any, level: str, short_mode: bool = False) -> dict | None:
    if not isinstance(data, dict) or not data.get("answer") or not isinstance(data["answer"], str):
        return None
    if contains_character_names(data["answer"]) or contains_character_names(data.get("bridgeLine") or ""):
        log.warning("[Explainer Guardrail] Response mentioned a character name. Rejecting.")
        return None

    sentences = split_sentences(data["answer"])[: get_max_sentence_count(level, short_mode)]
    if level == "little":
        max_words = 14
        trimmed = []
        for s in sentences:
            words = s.split()
            trimmed.append(" ".join(words[:max_words]) + "..." if len(words) > max_words else s)
        sentences = trimmed

    key_terms = data.get("keyTerms")
    return {
        "answer": " ".join(sentences),
        "safetyTip": data.get("safetyTip") or None,
        "keyTerms": key_terms[:3] if isinstance(key_terms, list) else [],
        "bridgeSkill": data.get("bridgeSkill") if data.get("bridgeSkill") in VALID_SKILLS else "cause_effect",
        "bridgeLine": data.get("bridgeLine") or "",
        "readingLevelCheck": data.get("readingLevelCheck"),
    }


def _qr(label: str, value: str) -> dict:
    return {"label": label, "value": value, "action": "quick"}


def build_bridge_message(bridge_skill: str, twin: Any = None) -> dict:
    interests = getattr(twin, "interests", None) or []

    if bridge_skill in ("cause_effect", "observation", "light"):
        return {
            "character": "petalo",
            "conceptId": "light_everyday",
            "message": "That's cause and effect! Petalo 🌸 loves observing cause and effect with light. In Petalo's build, light creates bright reflections! Want to explore light reflection?",
            "primaryReply": _qr("🌸 Explore with Petalo", "start_light_everyday"),
        }
    if bridge_skill == "energy":
        return {
            "character": "quacky",
            "conceptId": "battery_energy",
            "message": "That connects to energy! Quacky 🦆 uses battery energy to power real paper robots. Want to explore battery power with Quacky?",
            "primaryReply": _qr("🦆 Explore with Quacky", "start_battery_energy"),
        }
    if bridge_skill == "motion":
        tiko = any(i in interests for i in ("scorpions", "animals", "mechanics"))
        if tiko:
            return {
                "character": "tiko",
                "conceptId": "motor_motion",
                "message": "That's mechanical motion! Tiko 🦂 uses a spinning motor to move his scorpion tail up and down. Want to explore motion with Tiko?",
                "primaryReply": _qr("🦂 Explore with Tiko", "start_motor_motion"),
            }
        return {
            "character": "quacky",
            "conceptId": "motor_motion",
            "message": "That's mechanical motion! Quacky 🦆 uses a spinning DC motor to waddle. Want to explore motor motion with Quacky?",
            "primaryReply": _qr("🦆 Explore with Quacky", "start_motor_motion"),
        }
    if bridge_skill == "circuits":
        return {
            "character": "quacky",
            "conceptId": "simple_circuit",
            "message": "That connects to electrical circuits! In Quacky's 🦆 build, a simple closed loop powers the robot. Want to explore circuits with Quacky?",
            "primaryReply": _qr("🦆 Explore with Quacky", "start_simple_circuit"),
        }
    if bridge_skill == "sequencing":
        return {
            "character": "tolly",
            "conceptId": "led_sequence",
            "message": "That connects to step-by-step sequencing! Tolly 🚦 uses timer circuits to power red-yellow-green LED sequences. Want to explore sequencing with Tolly?",
            "primaryReply": _qr("🚦 Explore with Tolly", "start_led_sequence"),
        }
    if bridge_skill == "troubleshooting":
        return {
            "character": "tiko",
            "conceptId": "troubleshooting",
            "message": "That connects to finding solutions and troubleshooting! Tiko 🦂 loves diagnosing why a mechanism stops. Want to explore troubleshooting with Tiko?",
            "primaryReply": _qr("🦂 Explore with Tiko", "start_troubleshooting"),
        }
    return {
        "character": "wavy",
        "conceptId": "simple_circuit",
        "message": "Science is full of amazing discoveries! Want to explore a hands-on Funobotz STEM project?",
        "primaryReply": _qr("🚀 Explore with Wavy", "start_simple_circuit"),
    }


def get_bridge_quick_replies(bridge: dict) -> list[dict]:
    verified = [
        ("🦆 Quacky (Circuits)", "start_simple_circuit", "quacky"),
        ("🌸 Petalo (Light)", "start_light_everyday", "petalo"),
        ("🚦 Tolly (LED Timing)", "start_led_sequence", "tolly"),
        ("🦂 Tiko (Motion)", "start_motor_motion", "tiko"),
    ]
    others = [_qr(label, value) for label, value, char in verified if char != bridge["character"]][:2]
    return [bridge["primaryReply"], *others, _qr("🎲 Surprise me", "surprise_me")]


async def explain_general_science(
    *, question: str, twin: Any = None, domain: str = "physics", fallback_skill: str = "cause_effect"
) -> dict:
    age = getattr(twin, "age", 9) or 9
    level = determine_age_level(age, bool(getattr(twin, "wants_depth", False)))
    short_mode = bool(getattr(twin, "short_mode", False))
    language = getattr(twin, "language", "en") or "en"

    lang_instruction = (
        "IMPORTANT: Respond in simple, child-friendly Tamil. Keep scientific and technical terms in English."
        if language == "ta"
        else "Respond in English."
    )
    system_instruction = f"""You are BotzBuddy's general science explainer for a {age}-year-old child (level: {level}).
Answer the question accurately, safely, and at exactly this level:
{get_level_rules(level, short_mode)}

Label it as general science, not a Funobotz lesson.
Do not mention or invent any facts about Funobotz characters.
Do not give medical, dangerous, or adult instructions.
If the activity involves heat, sharp tools, chemicals, electricity from wall sockets, or cooking, add a one-line safety tip about asking a grown-up.
Never ask for personal information.
{lang_instruction}

Return JSON only:
{{
  "answer": string,
  "safetyTip": string | null,
  "keyTerms": [string],
  "bridgeSkill": "cause_effect" | "observation" | "energy" | "motion" | "circuits" | "light" | "sequencing" | "troubleshooting" | "none",
  "bridgeLine": string,
  "readingLevelCheck": "ok" | "too_hard"
}}"""

    try:
        result = await call_explainer_llm(
            prompt=f'Child asks: "{question}"\n\nExplain and return JSON:',
            system_instruction=system_instruction,
        )
        if result and result.get("data"):
            guarded = enforce_guardrails(result["data"], level, short_mode)
            if guarded:
                return {**guarded, "level": level, "age": age, "provider": result["provider"]}
    except Exception as err:  # noqa: BLE001
        log.warning("[Explainer] LLM call error: %s", err)

    return {
        "answer": SAFE_TEMPLATE,
        "safetyTip": None,
        "keyTerms": [],
        "bridgeSkill": fallback_skill or "cause_effect",
        "bridgeLine": "Curiosity is how every great scientist starts.",
        "readingLevelCheck": None,
        "level": level,
        "age": age,
        "provider": "safe-template",
    }
