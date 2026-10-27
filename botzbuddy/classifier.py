"""Three-tier question classifier.

- ``funobotz_stem``: approved concepts or character lore questions
- ``general_stem``: real science / tech / engineering / maths questions
- ``non_stem``: sports scores, celebrities, games, gossip
"""

from __future__ import annotations

import re
from typing import Any

from .llm import call_classifier_llm
from .registry import get_all_characters, get_all_concepts

CHARACTER_LORE_PATTERNS = [
    re.compile(
        r"\b(favourite|favorite|age|how old are you|where do you live|family|parents|programming language|superpowers?|powers?|what can you do in real life|who made you|girlfriend|boyfriend|food|eat|pet|hobby)\b",
        re.I,
    )
]

COMMON_SCIENCE_KEYWORDS: dict[str, list[str]] = {
    "biology": [
        "curd", "yogurt", "milk", "bacteria", "ferment", "plant", "tree", "animal", "cell", "human", "body",
        "heart", "lungs", "blood", "flower", "seed", "leaf", "leaves", "photosynthesis", "dinosaur", "digest",
        "germ", "dna", "gene", "bone", "muscle", "brain", "fungi", "mushroom", "chlorophyll",
    ],
    "chemistry": [
        "chemical", "acid", "base", "reaction", "bubble", "gas", "liquid", "solid", "melt", "freeze",
        "boil", "rust", "molecule", "atom", "salt", "sugar", "water", "oxygen", "hydrogen", "carbon",
        "evaporate", "condense", "dissolve", "element",
    ],
    "physics": [
        "sky", "blue", "rainbow", "gravity", "fall", "float", "magnet", "sound", "echo", "friction",
        "shadow", "sun", "moon", "star", "planet", "space", "orbit", "rocket", "plane", "fly", "flight",
        "bounce", "push", "pull", "pressure", "wave", "heat", "cold", "speed", "temperature", "force",
        "inertia", "optics", "prism", "reflection", "vacuum", "universe", "black hole", "telescope",
    ],
    "maths": [
        "calculate", "multiply", "multiplication", "divide", "division", "math", "maths", "plus", "minus",
        "square root", "geometry", "triangle", "fraction", "percentage", "algebra", "equation", "times",
    ],
    "technology": [
        "computer", "internet", "wifi", "phone", "software", "hardware", "code", "program", "algorithm",
        "screen", "chip", "microprocessor", "satellite", "bluetooth",
    ],
    "engineering": [
        "bridge", "building", "wheel", "gear", "pulley", "lever", "drone", "engine", "machine",
        "turbine", "crane", "aerodynamics", "structure",
    ],
}

NON_STEM_PATTERNS = [
    re.compile(
        r"\b(cricket|football|soccer|score|match|ipl|world cup|actor|actress|celebrity|movie|film|song|singer|dance|gossip|politics|president|minister|election|minecraft|fortnite|roblox|vbucks|cheat code|joke)\b",
        re.I,
    )
]

VALID_TIERS = ["funobotz_stem", "general_stem", "non_stem"]
VALID_DOMAINS = ["biology", "chemistry", "physics", "technology", "engineering", "maths", "other"]
VALID_SKILLS = ["cause_effect", "observation", "energy", "motion", "circuits", "light", "sequencing", "troubleshooting", "none"]

_MATH_OP = r"(?:x|\*|\+|\-|\/|times|divided by|plus|minus)"
_MATH_RE = re.compile(rf"\b\d+\s*{_MATH_OP}\s*\d+\b", re.I)


def is_math_expression(text: str | None) -> bool:
    return bool(text) and bool(_MATH_RE.search(text))


def _find_mentioned_character(lower: str) -> dict | None:
    for c in get_all_characters():
        if c["name"].lower() in lower or c["id"].lower() in lower:
            return c
    return None


def check_rule_based_classification(text: str | None, current_character: dict | None) -> dict | None:
    if not text:
        return None
    lower = text.strip().lower()
    mentioned = _find_mentioned_character(lower)

    if any(p.search(lower) for p in CHARACTER_LORE_PATTERNS):
        return {
            "tier": "funobotz_stem",
            "isUnsupportedCharacterFact": True,
            "domain": "funobotz",
            "bridgeSkill": "none",
            "character": mentioned["id"] if mentioned else ((current_character or {}).get("id") or "wavy"),
            "reason": "Character lore / unapproved character fact question",
        }

    if mentioned and any(w in lower for w in ("switch", "meet", "learn with", "talk to")):
        return {
            "tier": "funobotz_stem",
            "isUnsupportedCharacterFact": False,
            "domain": "funobotz",
            "bridgeSkill": "none",
            "character": mentioned["id"],
            "reason": "Character switch request",
        }

    if re.fullmatch(r"(continue|next|go ahead|ready|start)", lower, re.I):
        return {
            "tier": "funobotz_stem",
            "isUnsupportedCharacterFact": False,
            "isNavigation": True,
            "domain": "funobotz",
            "bridgeSkill": "none",
            "reason": "Navigation continuation keyword",
        }

    if re.search(r"\b(tell me something|hello|hi|hey|what can you do|who are you|greetings|help me choose)\b", lower, re.I):
        return {
            "tier": "funobotz_stem",
            "isVague": True,
            "domain": "funobotz",
            "bridgeSkill": "none",
            "reason": "Vague query or greeting",
        }

    for c in get_all_concepts():
        for kw in c.get("keywords") or []:
            if kw.lower() in lower:
                return {
                    "tier": "funobotz_stem",
                    "isUnsupportedCharacterFact": False,
                    "domain": "funobotz",
                    "bridgeSkill": "none",
                    "conceptId": c["id"],
                    "reason": f"Matched Funobotz concept keyword: {kw}",
                }

    if re.search(
        r"\b(build|assembled|experiment|observe|loop|circuit|motor|battery|switch|wire|led|stuck|already know|team up)\b",
        lower,
        re.I,
    ):
        return {
            "tier": "funobotz_stem",
            "isUnsupportedCharacterFact": False,
            "domain": "funobotz",
            "bridgeSkill": "none",
            "reason": "Active mission instruction or keyword",
        }

    return None


def _physics_bridge(lower: str) -> str:
    if any(w in lower for w in ("light", "sky", "blue", "rainbow", "shadow")):
        return "light"
    if any(w in lower for w in ("plane", "fly", "flight", "motion", "gravity", "speed")):
        return "motion"
    if any(w in lower for w in ("heat", "energy", "sun", "star")):
        return "energy"
    return "cause_effect"


def keyword_fallback_classification(text: str | None) -> dict:
    lower = (text or "").lower()

    if is_math_expression(text):
        return {
            "tier": "general_stem",
            "domain": "maths",
            "bridgeSkill": "sequencing",
            "reason": "Keyword fallback: Math expression detected",
        }

    if any(p.search(lower) for p in NON_STEM_PATTERNS):
        return {
            "tier": "non_stem",
            "domain": "other",
            "bridgeSkill": "none",
            "reason": "Keyword fallback: Non-STEM topic detected",
        }

    for domain, keywords in COMMON_SCIENCE_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                if domain == "physics":
                    skill = _physics_bridge(lower)
                elif domain == "maths":
                    skill = "sequencing"
                elif domain in ("technology", "engineering"):
                    skill = "circuits"
                else:
                    skill = "cause_effect"
                return {
                    "tier": "general_stem",
                    "domain": domain,
                    "bridgeSkill": skill,
                    "reason": f"Keyword fallback: Matched science term '{kw}' in {domain}",
                }

    if re.search(r"\b(why|how does|what is|how do|how is|where does)\b", lower, re.I):
        return {
            "tier": "general_stem",
            "domain": "physics",
            "bridgeSkill": "observation",
            "reason": "Keyword fallback: General inquisitive query",
        }

    return {
        "tier": "non_stem",
        "domain": "other",
        "bridgeSkill": "none",
        "reason": "Keyword fallback: No STEM keywords found",
    }


CLASSIFIER_SYSTEM = """You are a strict 3-tier question classifier for BotzBuddy, an adaptive STEM companion for children.
Classify the child's input into one of these 3 tiers:
- "funobotz_stem": Specifically about Funobotz paper robotics kits, character names (Quacky, Tiko, Tolly, Petalo, Cuby, Emoti, Wavy), or paper circuits.
- "general_stem": A genuine science, technology, engineering, biology, chemistry, physics, astronomy, or mathematics question (e.g., "how is curd made", "why is the sky blue", "how do planes fly", "what is 7 x 8", "why do leaves change color").
- "non_stem": Non-STEM topics such as cricket/football scores, video games, movie celebrities, gossip, or general chit-chat.

You must return ONLY a JSON object:
{
  "tier": "funobotz_stem" | "general_stem" | "non_stem",
  "domain": "biology" | "chemistry" | "physics" | "technology" | "engineering" | "maths" | "other",
  "bridgeSkill": "cause_effect" | "observation" | "energy" | "motion" | "circuits" | "light" | "sequencing" | "troubleshooting" | "none"
}"""


async def classify_question(*, text: str | None, current_character: dict | None = None, twin: Any = None) -> dict:
    if not text or not isinstance(text, str):
        return {"tier": "non_stem", "domain": "other", "bridgeSkill": "none", "reason": "Empty text"}

    clean = text.strip()
    rule = check_rule_based_classification(clean, current_character)
    if rule:
        return rule

    try:
        llm_res = await call_classifier_llm(
            prompt=f'Child question: "{clean}"\n\nClassify and return JSON:',
            system_instruction=CLASSIFIER_SYSTEM,
        )
    except Exception:  # noqa: BLE001
        llm_res = None

    if llm_res and llm_res.get("data", {}).get("tier"):
        data = llm_res["data"]
        tier = data["tier"] if data["tier"] in VALID_TIERS else "general_stem"
        domain = data.get("domain") if data.get("domain") in VALID_DOMAINS else "physics"
        skill = data.get("bridgeSkill") if data.get("bridgeSkill") in VALID_SKILLS else "cause_effect"
        return {
            "tier": tier,
            "domain": domain,
            "bridgeSkill": skill,
            "provider": llm_res["provider"],
            "reason": f"LLM classified as {tier} ({domain})",
        }

    return keyword_fallback_classification(clean)
