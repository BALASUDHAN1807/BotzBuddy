"""Adaptive brain: routes every learner turn through safety, classification and the mission engine.

Mission stages: Build -> Experiment -> Observe -> Explain (teach-back) -> Create -> Complete.
"""

from __future__ import annotations

import random
import re
from typing import Any

from .analyzer import analyze_teach_back
from .classifier import classify_question
from .explainer import build_bridge_message, explain_general_science, get_bridge_quick_replies
from .llm import talker_rewrite
from .registry import get_all_characters, get_all_concepts, get_character, get_concept
from .safety import check_safety
from .storage import add_curiosity_question
from .twin import LearningTwin, get_mastery_level
from .utils import parse_index

# --------------------------------------------------------------- intent helpers
STUCK_RE = re.compile(
    r"\b(i'?m stuck|stuck|help me|i don'?t get it|i don'?t understand|huh|confused|what do you mean|i am lost|too hard)\b",
    re.I,
)
ALREADY_KNOW_RE = re.compile(r"\b(i already know this|i know this|too easy|skip this|already learned|already know)\b", re.I)
CHANGE_INTEREST_RE = re.compile(
    r"\b(actually i want|change interest|i like|i want to learn about|let'?s talk about|switch to|something else)\b", re.I
)
SWITCH_TEXT_RE = re.compile(r"\b(teach me with|talk to|switch to|meet|choose|select|i want to learn with)\b", re.I)


def is_stuck_intent(text: str) -> bool:
    return bool(text) and bool(STUCK_RE.search(text))


def is_already_know_intent(text: str) -> bool:
    return bool(text) and bool(ALREADY_KNOW_RE.search(text))


def is_change_interest_intent(text: str) -> bool:
    return bool(text) and bool(CHANGE_INTEREST_RE.search(text))


def _verified() -> list[dict]:
    return [c for c in get_all_characters() if c.get("status") == "verified"]


def get_verified_characters_for_concept(concept_id: str | None) -> list[dict]:
    if not concept_id:
        return []
    return [c for c in _verified() if concept_id in (c.get("concepts") or [])]


APPROVED_CONCEPT_FACTS = {
    "quacky": "In my build, a BO motor powered through a simple circuit creates rotational spin to make me waddle! 🦆",
    "tiko": "In my build, a motor creates up-and-down thread-based tail movement so I can strike like a scorpion! 🦂",
    "tolly": "In my build, circuit connections power the timer and red-yellow-green LED sequence! 🚦",
    "petalo": "In my build, light from challenge cards illuminates everyday objects and creates bright reflections! 🌸",
}


def get_approved_fact_for_concept(char_id: str, concept_id: str) -> str:
    c = get_character(char_id)
    if not c:
        return ""
    if char_id in APPROVED_CONCEPT_FACTS:
        return APPROVED_CONCEPT_FACTS[char_id]
    return (c.get("facts") or [""])[0]


# ------------------------------------------------------- routing and scoring
def select_best_character(
    *,
    concept_id: str | None,
    interests: list[str] | None = None,
    current_character_id: str = "wavy",
    requested_character_id: str | None = None,
    context_slug: str | None = None,
    twin: LearningTwin | None = None,
) -> dict:
    interests = interests or []
    scores = []
    next_unmastered = None
    if twin is not None:
        next_unmastered = next((cn for cn in get_all_concepts() if twin.mastery.get(cn["id"], 0) < 75), None)

    for c in _verified():
        score = 0
        reasons = []
        if concept_id in c["concepts"]:
            score += 15
            reasons.append(f"teaches {concept_id} (+15)")
        else:
            score -= 20

        hits = 0
        for tag in c.get("interestTags") or []:
            for interest in interests:
                t, i = tag.lower(), str(interest).lower()
                if i in t or t in i:
                    hits += 1
        if hits:
            score += hits * 2
            reasons.append(f"interest matches ({hits}x2)")

        if c["id"] == current_character_id:
            score += 3
            reasons.append("current character continuity (+3)")

        if requested_character_id and c["id"] == requested_character_id.lower():
            score += 10
            reasons.append("explicitly requested (+10)")

        if context_slug and (c.get("productSlug") == context_slug or c["id"] == context_slug):
            score += 5
            reasons.append("kit page context match (+5)")

        if next_unmastered and next_unmastered["id"] in c["concepts"]:
            score += 1
            reasons.append("teaches next unmastered concept (+1)")

        scores.append({"character": c, "score": score, "reasons": ", ".join(reasons)})

    scores.sort(key=lambda s: s["score"], reverse=True)  # stable, like Array.prototype.sort
    best = scores[0]["character"] if scores else get_character("wavy")
    return {
        "best": best,
        "alternatives": [{"id": s["character"]["id"], "name": s["character"]["name"], "score": s["score"]} for s in scores[1:4]],
        "score": scores[0]["score"] if scores else 0,
        "reason": scores[0]["reasons"] if scores else "Default selection",
    }


def find_concept_for_interests(interests: list[str] | None = None, mastery: dict | None = None) -> dict:
    interests = interests or []
    mastery = mastery or {}
    concepts = get_all_concepts()
    best = None
    highest = -1
    for c in concepts:
        if mastery.get(c["id"], 0) >= 75:
            continue
        hits = 0
        for kw in c.get("keywords") or []:
            for interest in interests:
                i = str(interest).lower()
                if i in kw or kw in i:
                    hits += 1
        if hits > highest:
            highest = hits
            best = c
    if not best:
        best = next((c for c in concepts if mastery.get(c["id"], 0) < 75), concepts[0])
    return best


def find_concept_in_text(text: str) -> dict | None:
    if not text:
        return None
    lower = text.lower()
    for c in get_all_concepts():
        if any(kw in lower for kw in c.get("keywords") or []):
            return c
    return None


def detect_character_mention(text: str) -> dict | None:
    if not text:
        return None
    lower = text.lower()
    for c in get_all_characters():
        if c["name"].lower() in lower or c["id"].lower() in lower:
            return c
    return None


# -------------------------------------------------------------- message helpers
def qr(label: str, value: str, action: str = "quick", **extra: Any) -> dict:
    return {"label": label, "value": value, "action": action, **extra}


def get_persistent_quick_replies() -> list[dict]:
    return [
        qr("🧠 I already know this", "already_know"),
        qr("🆘 I'm stuck", "stuck"),
        qr("🔄 Change my interest", "change_interest"),
    ]


def format_explanation(concept: dict | None, twin: LearningTwin) -> str:
    if not concept or not concept.get("explain"):
        return ""
    ex = concept["explain"]
    if twin.wants_depth or twin.mastery.get(concept["id"], 0) > 75:
        return ex.get("deep") or ex.get("older") or ex.get("young") or ""
    if twin.short_mode or twin.age_band == "young":
        return ex.get("young") or ex.get("older") or ""
    return ex.get("older") or ex.get("young") or ""


def _level_of(twin: LearningTwin, concept_id: str | None) -> str:
    return get_mastery_level(twin.mastery.get(concept_id, 0) if concept_id else 0)["level"]


def _finish(
    twin: LearningTwin,
    messages: list[dict],
    quick_replies: list[dict],
    decision: dict,
    *,
    log_reason: str | None = None,
    log: bool = True,
) -> dict:
    """Build the API response, logging the decision on the twin."""
    decision = {**decision, "signalsUsed": dict(twin.signals)}
    decision.setdefault("alternatives", [])
    if log:
        logged = {k: v for k, v in decision.items() if k != "alternatives"}
        if log_reason:
            logged["reason"] = log_reason
        twin.add_decision(logged)
    return {"messages": messages, "quickReplies": quick_replies, "state": twin.to_summary(), "decision": decision}


def _msg(kind: str, character: str, text: str, data: dict | None = None) -> dict:
    m = {"type": kind, "character": character, "text": text}
    if data is not None:
        m["data"] = data
    return m


def _wavy_menu(twin: LearningTwin, level: str, alternatives: list[dict]) -> dict:
    wavy = get_character("wavy") or get_character(twin.current_character) or {"id": "wavy"}
    messages = [
        _msg(
            "text",
            wavy["id"],
            "I'm Wavy 👋, your Funobotz welcoming guide! I'm here to connect you with our wonderful STEM friends. What are you most curious to build today?",
        )
    ]
    replies = [qr(f"✨ {c['name']}", f"start_{c['id']}") for c in get_all_concepts()[:4]]
    replies.append(qr("🎲 Surprise me!", "surprise_me"))
    return _finish(
        twin,
        messages,
        replies,
        {
            "intent": "vague_clarification",
            "concept": twin.current_concept,
            "character": "wavy",
            "alternatives": alternatives,
            "level": level,
            "reason": "Wavy clarified vague query with options",
            "provider": "rule-based",
        },
        log_reason="Vague query or unmapped input: Wavy clarified with tap options",
    )


def _start_concept(twin: LearningTwin, target: dict, intro: str, intent: str, reason: str, log_reason: str) -> dict:
    """Hand off to the best character for ``target`` and open its Build stage."""
    routing = select_best_character(
        concept_id=target["id"],
        interests=[target["name"], *(target.get("keywords") or [])],
        current_character_id=twin.current_character,
        twin=twin,
    )
    best = routing["best"]
    old = get_character(twin.current_character)
    twin.current_character = best["id"]
    twin.current_concept = target["id"]
    twin.stage = "build"
    twin.reset_hint_level()

    messages = [
        _msg("handoff", best["id"], intro.format(concept=target["name"], name=best["name"]),
             {"from": old["id"] if old else None, "to": best["id"], "emoji": best["emoji"]}),
        _msg(
            "build",
            best["id"],
            f"Hey! I'm {best['name']} {best['emoji']}.\n\n{format_explanation(target, twin)}\n\n🔨 Step 1 (Build): {target.get('build', '')}",
            {"conceptId": target["id"], "parts": target.get("virtualBuild") or ["battery", "wire", "motor"]},
        ),
    ]
    replies = [qr("✅ Build completed!", "build_done")]
    if len(get_verified_characters_for_concept(target["id"])) >= 2:
        replies.append(qr("🤝 Team-Up!", "team_up"))
    replies += get_persistent_quick_replies()

    return _finish(
        twin,
        messages,
        replies,
        {
            "intent": intent,
            "concept": target["id"],
            "character": best["id"],
            "alternatives": routing["alternatives"],
            "level": _level_of(twin, target["id"]),
            "reason": reason.format(concept=target["name"], name=best["name"]),
            "provider": "rule-based",
        },
        log_reason=log_reason.format(concept=target["name"], name=best["name"]),
    )


# =====================================================================
# Main adaptive brain processor
# =====================================================================
async def process_message(*, twin: LearningTwin, text: str = "", action: dict | None = None) -> dict:
    clean = (text or "").strip()
    lower = clean.lower()
    action = action if isinstance(action, dict) else None
    # Quick-reply objects carry their kind in "action"; explicit actions use "type".
    action_type = (action.get("type") or action.get("action")) if action else None
    value = action.get("value") if action else None
    value = value if isinstance(value, str) else ""

    level = _level_of(twin, twin.current_concept)

    if clean:
        twin.record_signal("say")
    if action_type in ("quick", "observe", "check"):
        twin.record_signal("choose")
    if action_type == "build":
        twin.record_signal("build")
    twin.touch()

    # ------------------------------------------------------------ 1. SAFETY
    safety = check_safety(clean)
    if safety and not safety["safe"]:
        return _finish(
            twin,
            [_msg("text", twin.current_character, safety["message"])],
            [qr("Continue learning", "continue"), *get_persistent_quick_replies()],
            {
                "intent": "safety",
                "concept": twin.current_concept,
                "character": twin.current_character,
                "level": level,
                "reason": f"Safety violation handled: {safety['category']}",
                "provider": "rule-based",
            },
            log_reason=f"Safety triggered: {safety['category']}",
        )

    # ------------------------------------------- 1b. CHIP VALUES (start_/switch_/surprise_me)
    if value.startswith("switch_"):
        action = {**action, "type": "select_character", "characterId": value[len("switch_"):]}
        action_type = "select_character"

    if value.startswith("start_") or value == "surprise_me":
        if value == "surprise_me":
            pool = [c for c in get_all_concepts() if twin.mastery.get(c["id"], 0) < 75 and c["id"] != twin.current_concept]
            target = random.choice(pool or get_all_concepts())
        else:
            target = get_concept(value[len("start_"):])
        if target:
            return _start_concept(
                twin,
                target,
                "Let's explore {concept} with {name}!",
                "concept_selected",
                "Learner chose {concept}",
                "Learner chose {concept} → routed to {name}",
            )

    # ------------------------------------------- 2. CHARACTER SWITCH / SELECTION
    mentioned = detect_character_mention(clean)
    if not mentioned and action_type == "select_character":
        mentioned = get_character(action.get("characterId"))
    wants_switch_text = bool(SWITCH_TEXT_RE.search(clean))

    if mentioned and (wants_switch_text or action_type == "select_character" or lower == mentioned["name"].lower()):
        status = mentioned.get("status")
        verified = _verified()

        if status == "verified":
            old = get_character(twin.current_character)
            twin.current_character = mentioned["id"]
            target_id = twin.current_concept if twin.current_concept in mentioned["concepts"] else mentioned["concepts"][0]
            twin.current_concept = target_id
            twin.stage = "build"
            twin.reset_hint_level()
            target = get_concept(target_id)

            first_fact = (mentioned.get("facts") or [""])[0]
            draft = f"Woohoo! I'm {mentioned['name']} {mentioned['emoji']}! {first_fact} Let's dive into {target['name']}!"
            rewritten = await talker_rewrite(character=mentioned, draft=draft, twin=twin)

            messages = [
                _msg("handoff", mentioned["id"], f"Handoff: Meet {mentioned['name']}!",
                     {"from": old["id"] if old else None, "to": mentioned["id"], "emoji": mentioned["emoji"]}),
                _msg("text", mentioned["id"], rewritten["text"]),
                _msg(
                    "build",
                    mentioned["id"],
                    f"{format_explanation(target, twin)}\n\n🔨 Step 1 (Build): {target.get('build', '')}",
                    {"conceptId": target["id"], "parts": target.get("virtualBuild") or ["battery", "wire", "load"]},
                ),
            ]
            reason = f"Switched to verified character {mentioned['name']}"
            return _finish(
                twin,
                messages,
                [qr("✅ I did the build!", "build_done"), *get_persistent_quick_replies()],
                {
                    "intent": "switch_character",
                    "concept": twin.current_concept,
                    "character": twin.current_character,
                    "level": level,
                    "reason": reason,
                    "provider": rewritten["provider"],
                },
            )

        if status == "behaviour_only" and verified:
            known = (mentioned.get("facts") or ["A wonderful interactive Funobotz friend."])[0]
            suggested = verified[0]
            text_out = (
                f"Hi there! I'm {mentioned['name']} {mentioned['emoji']}. {known}\n\n"
                f"My full STEM concept lessons are coming soon! In the meantime, my friend {suggested['name']} "
                f"{suggested['emoji']} is ready with an exciting hands-on mission. Want to learn with {suggested['name']}?"
            )
            return _finish(
                twin,
                [_msg("text", mentioned["id"], text_out)],
                [qr(f"🚀 Learn with {suggested['name']}", f"switch_{suggested['id']}"), qr("👋 Back to Wavy", "switch_wavy")],
                {
                    "intent": "behaviour_only_handoff",
                    "concept": twin.current_concept,
                    "character": mentioned["id"],
                    "alternatives": [{"id": v["id"], "name": v["name"]} for v in verified],
                    "level": level,
                    "reason": f"Behaviour-only character {mentioned['name']} suggested verified character",
                    "provider": "rule-based",
                },
            )

        if status == "awaiting_concept_sheet" and verified:
            suggested = verified[0]
            text_out = (
                f"Hello! I'm {mentioned['name']} {mentioned['emoji']}. Honestly, my STEM lessons haven't been released "
                f"yet by Funobotz engineers! But our verified friends like {suggested['name']} {suggested['emoji']}, "
                "Quacky 🦆, Tolly 🚦, and Tiko 🦂 are ready right now. Let's explore with one of them!"
            )
            return _finish(
                twin,
                [_msg("text", mentioned["id"], text_out)],
                [qr(f"{v['emoji']} {v['name']}", f"switch_{v['id']}") for v in verified[:3]],
                {
                    "intent": "awaiting_concept_sheet_honest",
                    "concept": twin.current_concept,
                    "character": mentioned["id"],
                    "alternatives": [{"id": v["id"], "name": v["name"]} for v in verified],
                    "level": level,
                    "reason": f"Honest declaration of awaiting concept sheet for {mentioned['name']}",
                    "provider": "rule-based",
                },
            )

    # ------------------------------- 3. THREE-TIER CLASSIFICATION + EXPLAINER
    current_char = get_character(twin.current_character) or get_character("wavy")
    is_continue = lower == "continue"
    is_team_up = value == "team_up" or "team-up" in lower or "team up" in lower
    is_inquiry = (
        bool(clean)
        and not action_type
        and not is_stuck_intent(clean)
        and not is_already_know_intent(clean)
        and not is_change_interest_intent(clean)
        and not is_team_up
        and not is_continue
    )

    if is_inquiry:
        cls = await classify_question(text=clean, current_character=current_char, twin=twin)

        if cls.get("isVague"):
            return _wavy_menu(twin, level, [])

        # Tier 1A: unsupported character fact -> Curiosity Jar
        if cls["tier"] == "funobotz_stem" and cls.get("isUnsupportedCharacterFact"):
            add_curiosity_question(
                question=clean,
                character_asked=current_char["name"],
                age_band=twin.age_band,
                context=twin.context,
                tier="unsupported_fact",
                domain="funobotz",
            )
            facts = "\n".join(f"• {f}" for f in current_char.get("facts") or []) or "• Official Funobotz guide"
            reply = (
                "I don't have an approved Funobotz fact about that yet, so I won't make one up! 🛡️\n\n"
                "I've dropped your question into the 🏺 **Curiosity Jar** so the Funobotz team can see what kids want to learn!\n\n"
                f"Here are the approved facts I know about {current_char['name']}:\n{facts}\n\n"
                "Want to explore an approved STEM topic instead?"
            )
            return _finish(
                twin,
                [_msg("text", twin.current_character, reply)],
                [qr("🚀 Continue STEM mission", "continue"), *get_persistent_quick_replies()],
                {
                    "intent": "curiosity_jar",
                    "tier": "funobotz_stem",
                    "domain": "funobotz",
                    "concept": twin.current_concept,
                    "character": twin.current_character,
                    "level": level,
                    "reason": "Unsupported fact logged to Curiosity Jar",
                    "provider": "rule-based",
                },
                log_reason="Unsupported character fact detected → logged to Curiosity Jar",
            )

        # Tier 2: general STEM
        if cls["tier"] == "general_stem":
            domain = cls.get("domain") or "physics"
            bridge_skill = cls.get("bridgeSkill") or "cause_effect"
            strict = twin.general_stem_mode is False or twin.general_stem_mode == "off"

            add_curiosity_question(
                question=clean,
                character_asked=current_char["name"],
                age_band=twin.age_band,
                context=twin.context,
                tier="general_stem",
                domain=domain,
            )
            twin.record_curiosity_domain(domain)

            if strict:
                bridge = build_bridge_message(bridge_skill, twin)
                messages = [
                    _msg(
                        "text",
                        current_char["id"],
                        "That's real science! 🔬 It's not in today's Funobotz lessons, so I've saved it for the team in the Curiosity Jar.",
                    ),
                    _msg("text", bridge["character"], bridge["message"]),
                ]
                return _finish(
                    twin,
                    messages,
                    get_bridge_quick_replies(bridge),
                    {
                        "intent": "general_stem_strict_mode",
                        "tier": "general_stem",
                        "domain": domain,
                        "concept": twin.current_concept,
                        "character": current_char["id"],
                        "level": "strict_curriculum",
                        "bridgeSkill": bridge_skill,
                        "bridgeChoice": bridge["character"],
                        "reason": "General STEM redirected (strict curriculum mode)",
                        "provider": "rule-based",
                    },
                    log_reason="General STEM question asked with general-stem mode OFF → saved to Curiosity Jar & bridged",
                )

            result = await explain_general_science(question=clean, twin=twin, domain=domain, fallback_skill=bridge_skill)
            active_skill = result.get("bridgeSkill") or bridge_skill
            bridge = build_bridge_message(active_skill, twin)
            messages = [
                _msg(
                    "general_stem",
                    "wavy",
                    result["answer"],
                    {
                        "safetyTip": result.get("safetyTip"),
                        "keyTerms": result.get("keyTerms"),
                        "domain": domain,
                        "level": result["level"],
                        "readingLevelCheck": result.get("readingLevelCheck"),
                    },
                ),
                _msg("text", bridge["character"], bridge["message"]),
            ]
            return _finish(
                twin,
                messages,
                get_bridge_quick_replies(bridge),
                {
                    "intent": "general_stem_explained",
                    "tier": "general_stem",
                    "domain": domain,
                    "ageLevel": result["level"],
                    "concept": twin.current_concept,
                    "character": current_char["id"],
                    "level": result["level"],
                    "bridgeSkill": active_skill,
                    "bridgeChoice": bridge["character"],
                    "reason": f"General STEM explained at '{result['level']}' level via {result['provider']}",
                    "provider": result["provider"],
                },
            )

        # Tier 3: non-STEM -> redirect
        if cls["tier"] == "non_stem":
            add_curiosity_question(
                question=clean,
                character_asked=current_char["name"],
                age_band=twin.age_band,
                context=twin.context,
                tier="non_stem",
                domain=cls.get("domain") or "other",
            )
            topic = "that topic" if len(clean) > 40 else clean
            reply = (
                f"I'm BotzBuddy, your STEM and robotics friend! 🤖 I don't know much about {topic}, but I've saved your "
                "question in the 🏺 **Curiosity Jar**!\n\nWant to explore moving paper robots, glowing lights, or traffic circuits instead?"
            )
            return _finish(
                twin,
                [_msg("text", current_char["id"], reply)],
                [
                    qr("🦆 Circuits with Quacky", "start_simple_circuit"),
                    qr("🌸 Light with Petalo", "start_light_everyday"),
                    qr("🚦 LEDs with Tolly", "start_led_sequence"),
                    *get_persistent_quick_replies(),
                ],
                {
                    "intent": "non_stem_redirect",
                    "tier": "non_stem",
                    "domain": "other",
                    "concept": twin.current_concept,
                    "character": current_char["id"],
                    "level": level,
                    "reason": "Non-STEM topic redirected",
                    "provider": "rule-based",
                },
                log_reason="Non-STEM topic detected → redirected with Curiosity Jar log",
            )

    # --------------------------------------------------- CONFIDENCE METER
    if action_type == "confidence" or value.startswith("conf_"):
        raw = value or "conf_sure"
        conf = action.get("level") or ("sure" if raw == "conf_sure" else "unsure" if raw == "conf_unsure" else "medium")
        is_correct = action["isCorrect"] if action.get("isCorrect") is not None else "unsure" not in raw
        target = twin.current_concept or "simple_circuit"
        twin.set_concept_confidence(target, conf)

        if is_correct and conf == "sure":
            twin.adjust_mastery(target, 5)
            twin.add_xp(5)
            feedback, reason = "😎 High confidence & spot on! +5 Bonus Mastery awarded!", "Correct and very sure (+5 bonus mastery)"
        elif is_correct and conf == "unsure":
            twin.queue_memory_boost(target)
            feedback = "🙂 Great job! We will do a quick Memory Boost later to cement this concept!"
            reason = "Correct but not sure → scheduled Memory Boost"
        elif not is_correct and conf == "sure":
            twin.adjust_mastery(target, -5)
            feedback = "🤔 You felt sure, but let's test this with a concrete experiment! (-5 mastery)"
            reason = "Wrong but very sure → likely misconception"
        else:
            feedback = "🌱 That's okay! Step-by-step discovery is how great engineers learn."
            reason = "Wrong and unsure → encouraging hint"

        return _finish(
            twin,
            [_msg("text", twin.current_character, feedback)],
            [qr("🚀 Continue mission", "continue"), *get_persistent_quick_replies()],
            {
                "intent": "confidence_rule",
                "concept": target,
                "character": twin.current_character,
                "level": _level_of(twin, target),
                "reason": reason,
                "provider": "rule-based",
            },
        )

    # --------------------------------------------------- MEMORY BOOST ANSWER
    if action_type == "memory_boost" or value.startswith("boost_ans_"):
        idx = action.get("index") if action.get("index") is not None else parse_index(value or "boost_ans_0", "boost_ans_")
        concept = get_concept(twin.active_boost_concept or twin.current_concept) or get_all_concepts()[0]
        correct = idx == concept["check"]["answer"]

        if correct:
            twin.adjust_mastery(concept["id"], 10)
            twin.add_xp(15)
            messages = [
                _msg(
                    "memory_boost_result",
                    twin.current_character,
                    f"✨ **Sparkle!** Perfect memory recall! +10 mastery awarded for **{concept['name']}**!",
                )
            ]
        else:
            hint = (concept.get("hints") or ["Remember to check the closed circuit loop!"])[0]
            messages = [_msg("text", twin.current_character, f"🌱 Good try! Quick tip for next time: {hint}")]

        twin.stage = "build"
        twin.active_boost_concept = None
        return _finish(
            twin,
            messages,
            [qr("🚀 Continue to next challenge", "continue"), *get_persistent_quick_replies()],
            {
                "intent": "memory_boost_completed",
                "concept": concept["id"],
                "character": twin.current_character,
                "level": _level_of(twin, concept["id"]),
                "reason": "Memory boost correct (+10 mastery)" if correct else "Memory boost hint provided",
                "provider": "rule-based",
            },
            log_reason="Memory boost correct (+10 mastery)" if correct else "Memory boost hint provided (no penalty)",
        )

    # Memory Boost spaced-revisit trigger
    boost_id = None
    if twin.stage in ("idle", "complete") or value == "continue" or is_continue:
        boost_id = twin.get_next_memory_boost()
    if boost_id and get_concept(boost_id):
        concept = get_concept(boost_id)
        twin.stage = "memory_boost"
        twin.active_boost_concept = concept["id"]
        char = get_character(twin.current_character) or get_character("wavy")
        options = concept["check"].get("options") or []
        return _finish(
            twin,
            [
                _msg(
                    "memory_boost",
                    char["id"],
                    f"✨ **Quick Memory Boost!** Let's see how much you remember about **{concept['name']}**!\n\n❓ {concept['check']['q']}",
                    {"conceptId": concept["id"], "options": options},
                )
            ],
            [qr(opt, f"boost_ans_{i}", "memory_boost") for i, opt in enumerate(options)],
            {
                "intent": "memory_boost",
                "concept": concept["id"],
                "character": char["id"],
                "level": _level_of(twin, concept["id"]),
                "reason": "Concept still developing → spaced revisit",
                "provider": "rule-based",
            },
        )

    # --------------------------------------------------- CHARACTER TEAM-UP
    if is_team_up:
        concept = get_concept(twin.current_concept) or get_all_concepts()[0]
        team = get_verified_characters_for_concept(concept["id"])
        if len(team) >= 2:
            c1, c2 = team[0], team[1]
            twin.stage = "teamup"
            twin.current_concept = concept["id"]
            twin.active_team_up = {"chars": [c1["id"], c2["id"]], "conceptId": concept["id"]}
            f1 = get_approved_fact_for_concept(c1["id"], concept["id"])
            f2 = get_approved_fact_for_concept(c2["id"], concept["id"])
            prompt = (concept.get("teamUp") or {}).get("prompt") or "What's the same in both of our robots?"
            text_out = (
                f"🤝 **Funobotz Team-Up!** {c1['name']} {c1['emoji']} and {c2['name']} {c2['emoji']} are working together!\n\n"
                f'**{c1["name"]}:** "{f1}"\n\n**{c2["name"]}:** "{f2}"\n\n❓ **Team-Up Question:** {prompt}'
            )
            reason = "Concept shared by multiple verified characters → team-up"
            return _finish(
                twin,
                [
                    _msg(
                        "teamup",
                        c1["id"],
                        text_out,
                        {
                            "char1": {"id": c1["id"], "name": c1["name"], "emoji": c1["emoji"], "fact": f1},
                            "char2": {"id": c2["id"], "name": c2["name"], "emoji": c2["emoji"], "fact": f2},
                            "prompt": prompt,
                        },
                    )
                ],
                [
                    qr("Both turn electrical energy into motion!", "tb_team_energy"),
                    qr("Both need a closed circuit loop!", "tb_team_circuit"),
                    qr("Both use a spinning DC motor!", "tb_team_motor"),
                ],
                {
                    "intent": "team_up",
                    "concept": concept["id"],
                    "character": c1["id"],
                    "alternatives": [{"id": c2["id"], "name": c2["name"]}],
                    "level": _level_of(twin, concept["id"]),
                    "reason": reason,
                    "provider": "rule-based",
                },
            )

    if twin.stage == "teamup" and clean:
        twin.record_signal("explain")
        concept = get_concept(twin.current_concept) or get_all_concepts()[0]
        twin.adjust_mastery(concept["id"], 15)
        twin.add_xp(20)
        twin.stage = "create"
        choices = (concept.get("create") or {}).get("choices") or []
        return _finish(
            twin,
            [
                _msg(
                    "text",
                    twin.current_character,
                    "🎉 Brilliant team-up observation! Even though our shapes and actions look different, the underlying "
                    f"STEM concept is identical!\n\n🚀 **Step 5 (Create):** {(concept.get('create') or {}).get('prompt', '')}",
                )
            ],
            [qr(ch, f"create_{i}", "create") for i, ch in enumerate(choices)],
            {
                "intent": "team_up_analyzed",
                "concept": concept["id"],
                "character": twin.current_character,
                "level": _level_of(twin, concept["id"]),
                "reason": "Team-up comparison analyzed successfully",
                "provider": "rule-based",
            },
            log_reason="Team-up comparison understood (+15 mastery, +20 XP)",
        )

    # --------------------------------------------- 4. "I ALREADY KNOW THIS"
    if is_already_know_intent(clean) or value == "already_know":
        concept = get_concept(twin.current_concept) or find_concept_for_interests(twin.interests, twin.mastery)
        twin.current_concept = concept["id"]
        options = concept["check"]["options"]
        return _finish(
            twin,
            [
                _msg(
                    "text",
                    twin.current_character,
                    f"Awesome confidence! Let's do a super quick micro-check on **{concept['name']}** to verify your superpowers!",
                ),
                _msg("check", twin.current_character, concept["check"]["q"], {"conceptId": concept["id"], "options": options}),
            ],
            [qr(opt, f"check_ans_{i}", "check") for i, opt in enumerate(options)],
            {
                "intent": "fast_track_micro_check",
                "concept": concept["id"],
                "character": twin.current_character,
                "level": level,
                "reason": "Fast-track micro check presented",
                "provider": "rule-based",
            },
            log_reason="Learner requested fast-track, presented micro-check MCQ",
        )

    # Micro-check answer
    if action_type == "check" or value.startswith("check_ans_"):
        idx = action.get("index") if action.get("index") is not None else parse_index(value, "check_ans_")
        concept = get_concept(twin.current_concept)
        correct = bool(concept) and idx == concept["check"]["answer"]

        if correct:
            twin.mastery[concept["id"]] = max(twin.mastery.get(concept["id"], 0), 80)
            twin.add_xp(20)
            nxt = next((c for c in get_all_concepts() if twin.mastery.get(c["id"], 0) < 75), get_all_concepts()[0])
            routing = select_best_character(
                concept_id=nxt["id"], interests=twin.interests, current_character_id=twin.current_character, twin=twin
            )
            twin.current_character = routing["best"]["id"]
            twin.current_concept = nxt["id"]
            twin.stage = "build"
            twin.reset_hint_level()
            return _finish(
                twin,
                [
                    _msg(
                        "text",
                        routing["best"]["id"],
                        f"🎯 Spot on! You already understand the basics of {concept['name']}. How confident did you feel about that answer?",
                    )
                ],
                [
                    qr("😎 Very sure", "conf_sure", "confidence", isCorrect=True),
                    qr("🙂 Kind of sure", "conf_medium", "confidence", isCorrect=True),
                    qr("😟 Not sure", "conf_unsure", "confidence", isCorrect=True),
                ],
                {
                    "intent": "micro_check_passed_skip",
                    "concept": nxt["id"],
                    "character": routing["best"]["id"],
                    "alternatives": routing["alternatives"],
                    "level": _level_of(twin, nxt["id"]),
                    "reason": f"Micro-check passed, advanced to {nxt['name']}",
                    "provider": "rule-based",
                },
                log_reason=f"Micro-check passed, mastery set to >=80, skipped to {nxt['name']}",
            )

        twin.stage = "build"
        return _finish(
            twin,
            [_msg("text", twin.current_character, "Interesting idea! How confident did you feel about that choice?")],
            [
                qr("😎 Very sure", "conf_sure", "confidence", isCorrect=False),
                qr("🙂 Kind of sure", "conf_medium", "confidence", isCorrect=False),
                qr("😟 Not sure", "conf_unsure", "confidence", isCorrect=False),
            ],
            {
                "intent": "micro_check_wrong",
                "concept": twin.current_concept,
                "character": twin.current_character,
                "level": _level_of(twin, twin.current_concept),
                "reason": "Micro-check answered incorrectly",
                "provider": "rule-based",
            },
            log=False,
        )

    # --------------------------------------------- 5. "I'M STUCK" HINT LADDER
    if is_stuck_intent(clean) or value == "stuck":
        concept = get_concept(twin.current_concept) or get_all_concepts()[0]
        hint_idx = twin.next_hint_level()
        labels = ["💡 Hint", "🔍 Concrete Example", "🛠️ Step-by-Step Demonstration", "📖 Full Explanation"]
        hints = concept.get("hints") or []
        hint = hints[hint_idx] if hint_idx < len(hints) else (hints[0] if hints else "Take your time to explore the parts!")
        return _finish(
            twin,
            [_msg("text", twin.current_character, f"{labels[hint_idx]}: {hint}")],
            [qr("👍 Got it, ready!", "continue"), qr("🆘 Still need another hint", "stuck"), *get_persistent_quick_replies()],
            {
                "intent": "stuck_hint_ladder",
                "concept": concept["id"],
                "character": twin.current_character,
                "level": _level_of(twin, concept["id"]),
                "reason": f"Hint ladder level {hint_idx + 1}",
                "provider": "rule-based",
            },
            log_reason=f"Delivered hint level {hint_idx + 1} ({labels[hint_idx]}), mastery adjusted -3",
        )

    # --------------------------------------------- 6. INTEREST CHANGE
    found = find_concept_in_text(clean)
    if (
        is_change_interest_intent(clean)
        or value == "change_interest"
        or (found and found["id"] != twin.current_concept and not twin.current_concept)
    ):
        target = found or next((c for c in get_all_concepts() if c["id"] != twin.current_concept), get_all_concepts()[0])
        return _start_concept(
            twin,
            target,
            "That connects to another exciting idea! Let's explore {concept} with {name}!",
            "interest_reroute",
            "Interest rerouted to {concept}",
            "Rerouted to {concept} and {name}, preserving existing mastery",
        )

    # --------------------------------------------- 7. MISSION ENGINE
    concept = get_concept(twin.current_concept) or find_concept_for_interests(twin.interests, twin.mastery)
    twin.current_concept = concept["id"]
    char = get_character(twin.current_character) or get_character("wavy")
    cid = concept["id"]

    # Stage A: BUILD -> Experiment
    if twin.stage == "build" or action_type == "build" or value == "build_done" or "done" in lower or "built" in lower:
        twin.stage = "experiment"
        twin.adjust_mastery(cid, 10)
        twin.add_xp(10)
        return _finish(
            twin,
            [
                _msg(
                    "text",
                    char["id"],
                    f"🎉 Fantastic hands-on build! You just assembled the real foundation.\n\n🧪 **Step 2 (Experiment):** {concept.get('experiment', '')}",
                )
            ],
            [qr(opt, f"observe_{i}", "observe") for i, opt in enumerate(concept.get("observeOptions") or [])],
            {
                "intent": "mission_experiment_stage",
                "concept": cid,
                "character": char["id"],
                "level": _level_of(twin, cid),
                "reason": "Transition to experiment prediction",
                "provider": "rule-based",
            },
            log_reason="Build completed (+10 mastery, +10 XP), transitioned to Experiment prediction",
        )

    # Stage B: OBSERVE -> Explain
    if twin.stage == "experiment" or action_type == "observe" or value.startswith("observe_"):
        twin.stage = "explain"
        if action and action.get("index") is not None:
            chosen = action["index"]
        else:
            chosen = parse_index(value or "observe_0", "observe_")
        if chosen == 0:
            twin.adjust_mastery(cid, 10)
            twin.add_xp(10)

        replies = [
            qr("Because it connects in a loop!", "tb_loop"),
            qr("Because light reflects into our eyes!", "tb_light"),
            qr("Because motor turns energy into motion!", "tb_motor"),
        ]
        if len(get_verified_characters_for_concept(cid)) >= 2:
            replies.append(qr("🤝 Team-Up!", "team_up"))
        replies += get_persistent_quick_replies()
        return _finish(
            twin,
            [
                _msg(
                    "text",
                    char["id"],
                    f"👀 **Step 3 (Observe):** {concept.get('observe', '')}\n\n🧠 **Step 4 (Explain):** {concept.get('teachBack', '')}",
                )
            ],
            replies,
            {
                "intent": "mission_explain_stage",
                "concept": cid,
                "character": char["id"],
                "level": _level_of(twin, cid),
                "reason": "Teach-back question presented",
                "provider": "rule-based",
            },
            log_reason="Observation reviewed, transitioned to Teach-back Explain stage",
        )

    # Stage C: EXPLAIN / teach-back analysis
    if twin.stage == "explain":
        twin.record_signal("explain")
        analysis = await analyze_teach_back(user_input=clean, concept=concept, character=char)

        if analysis.get("misconceptionId") and analysis.get("fix"):
            twin.record_misconception(cid, analysis["misconceptionId"], analysis["fix"])
            return _finish(
                twin,
                [
                    _msg(
                        "text",
                        char["id"],
                        f"🤔 Interesting idea! Let's test it: {analysis['fix']}\n\nNow, how would you explain it in your own words?",
                    )
                ],
                [
                    qr("Electricity needs a full round-trip loop!", "tb_fix_loop"),
                    qr("Batteries give power to motors!", "tb_fix_power"),
                    *get_persistent_quick_replies(),
                ],
                {
                    "intent": "misconception_handled",
                    "concept": cid,
                    "character": char["id"],
                    "level": _level_of(twin, cid),
                    "reason": f"Misconception detected: {analysis['misconceptionId']}",
                    "provider": analysis["provider"],
                },
                log_reason=f"Misconception '{analysis['misconceptionId']}' detected. Kept stage, applied fix (-5 mastery).",
            )

        xp_gain, delta, feedback = 15, 8, "Great job explaining that in your own words!"
        if analysis["understood"] == "strong":
            xp_gain, delta, feedback = 25, 20, "🌟 Outstanding! You explained that like a true STEM Master Engineer!"
        elif analysis["understood"] == "none":
            xp_gain, delta, feedback = 10, 3, "You're getting closer! Connecting real parts is how we master it."

        twin.adjust_mastery(cid, delta)
        xp = twin.add_xp(xp_gain)
        twin.stage = "create"
        create = concept.get("create") or {}
        messages = [_msg("text", char["id"], f"{feedback}\n\n🚀 **Step 5 (Create):** {create.get('prompt', '')}")]
        if xp["rankUp"]:
            messages.append(_msg("celebration", char["id"], f"🎉 RANK UP! You reached **{xp['newRank']}** {xp['rankEmoji']}!", xp))
        return _finish(
            twin,
            messages,
            [qr(ch, f"create_{i}", "create") for i, ch in enumerate(create.get("choices") or [])],
            {
                "intent": "mission_create_stage",
                "concept": cid,
                "character": char["id"],
                "level": _level_of(twin, cid),
                "reason": f"Teach-back understood: {analysis['understood']}",
                "provider": analysis["provider"],
            },
            log_reason=f"Teach-back evaluated as {analysis['understood']} (+{delta} mastery, +{xp_gain} XP). Moved to Create stage.",
        )

    # Stage D: CREATE -> mission complete, challenge card, kit or teacher card
    if twin.stage == "create" or action_type == "create" or value.startswith("create_"):
        twin.stage = "complete"
        xp = twin.add_xp(20)
        twin.adjust_mastery(cid, 10)

        end_mastery = twin.mastery.get(cid, 0)
        if 40 <= end_mastery <= 75:
            twin.queue_memory_boost(cid)

        choices = (concept.get("create") or {}).get("choices") or []
        chosen_choice = None
        if action:
            chosen_choice = action.get("choice") or (action.get("label") if action_type == "create" else None)
        if not chosen_choice:
            idx = parse_index(value, "create_")
            chosen_choice = choices[idx] if idx is not None and 0 <= idx < len(choices) else None
        chosen_choice = chosen_choice or (choices[0] if choices else "A wonderful creative project")

        messages = [_msg("text", char["id"], f'🎨 Masterpiece chosen: **"{chosen_choice}"**! You\'ve mastered **{concept["name"]}**!')]
        if xp["rankUp"]:
            messages.append(_msg("celebration", char["id"], f"🏆 CELEBRATION! You are now a **{xp['newRank']}** {xp['rankEmoji']}!", xp))

        messages.append(
            _msg(
                "challenge_card",
                char["id"],
                "📋 Here is your official Printable Funobotz STEM Challenge Card:",
                {
                    "characterName": char["name"],
                    "characterEmoji": char["emoji"],
                    "conceptName": concept["name"],
                    "choice": chosen_choice,
                    "badge": xp.get("rankEmoji") or "🏅",
                    "steps": [
                        f"1. Fold and cut the {char['name']} paper robot template.",
                        "2. Lay the conductive copper foil tape tracks according to the circuit diagram.",
                        f'3. Test and decorate your creation: "{chosen_choice}"!',
                    ],
                    "safetyTip": "Safety Tip: Only use small batteries (like AA or 3V coin cells), never wall sockets!",
                    "footer": "Made with BotzBuddy for Funobotz Paper Robotics",
                },
            )
        )

        if twin.context in ("class", "workshop"):
            messages.append(
                _msg(
                    "teacher",
                    char["id"],
                    f'🎉 Outstanding build! Show your teacher what you built: "{chosen_choice}"',
                    {"choice": chosen_choice, "conceptName": concept["name"], "characterName": char["name"]},
                )
            )
        elif char.get("productSlug") and char.get("kitUrl"):
            messages.append(
                _msg(
                    "kit",
                    char["id"],
                    "Want to build this in real life with official paper kits?",
                    {
                        "characterName": char["name"],
                        "productSlug": char["productSlug"],
                        "kitUrl": char["kitUrl"],
                        "emoji": char["emoji"],
                        "color": char["color"],
                    },
                )
            )

        nxt = next((c for c in get_all_concepts() if twin.mastery.get(c["id"], 0) < 75), None)
        if nxt:
            routing = select_best_character(
                concept_id=nxt["id"], interests=twin.interests, current_character_id=twin.current_character, twin=twin
            )
            messages.append(
                _msg(
                    "text",
                    char["id"],
                    f"Ready for your next adventure? Let's explore **{nxt['name']}** with {routing['best']['name']} {routing['best']['emoji']}!",
                )
            )
            replies = [qr(f"🚀 Start {nxt['name']}", f"start_{nxt['id']}"), *get_persistent_quick_replies()]
        else:
            messages.append(
                _msg(
                    "text",
                    char["id"],
                    "🌟 AMAZING! You have explored every STEM concept in the Funobotz universe! You can revisit any bot anytime.",
                )
            )
            replies = get_persistent_quick_replies()

        return _finish(
            twin,
            messages,
            replies,
            {
                "intent": "mission_completed",
                "concept": cid,
                "character": char["id"],
                "level": _level_of(twin, cid),
                "reason": "Mission completed successfully",
                "provider": "rule-based",
            },
            log_reason="Mission completed, challenge card generated, next concept suggested",
        )

    # --------------------------------------------- 8. FALLBACK: WAVY MENU
    return _wavy_menu(twin, level, [{"id": v["id"], "name": v["name"]} for v in _verified()])


# =====================================================================
# Onboarding / initial session
# =====================================================================
async def initialize_session(*, twin: LearningTwin, character_slug: str | None = None) -> dict:
    requested = None
    if character_slug:
        requested = next(
            (c for c in get_all_characters() if c.get("productSlug") == character_slug or c["id"] == character_slug),
            None,
        )

    if twin.explorer:
        twin.current_character = "wavy"
        twin.stage = "idle"
        return _finish(
            twin,
            [
                _msg(
                    "text",
                    "wavy",
                    "Hello, young explorer! 👋 I'm Wavy! Funobotz is full of moving paper robots, glowing circuits, and secret signals. What kind of invention are you curious about today?",
                )
            ],
            [
                qr("🤖 Walking robots", "start_motor_motion"),
                qr("🌸 Glowing lights", "start_light_everyday"),
                qr("🚦 Traffic signals", "start_led_sequence"),
                qr("🎲 Surprise me!", "surprise_me"),
            ],
            {
                "intent": "explorer_onboarding",
                "concept": None,
                "character": "wavy",
                "level": "Developing",
                "reason": "Explorer onboarding initiated",
                "provider": "rule-based",
            },
            log_reason="Explorer learner: Wavy initiates open discovery dialogue",
        )

    routing = None
    if requested:
        twin.current_character = requested["id"]
        if requested.get("status") == "verified":
            start = get_concept(requested["concepts"][0]) or get_all_concepts()[0]
        else:
            start = find_concept_for_interests(twin.interests, twin.mastery)
    else:
        start = find_concept_for_interests(twin.interests, twin.mastery)
        routing = select_best_character(
            concept_id=start["id"],
            interests=twin.interests,
            current_character_id=twin.current_character,
            context_slug=character_slug,
            twin=twin,
        )
        twin.current_character = routing["best"]["id"]

    twin.current_concept = start["id"]
    twin.stage = "build"

    char = get_character(twin.current_character) or get_character("wavy")
    first_fact = (char.get("facts") or [""])[0]
    draft = (
        f"Hi there! I'm {char['name']} {char['emoji']}! {first_fact}\n\n"
        f"Today we are exploring **{start['name']}**!\n\n{format_explanation(start, twin)}\n\n"
        f"🔨 Step 1 (Build): {start.get('build', '')}"
    )
    rewritten = await talker_rewrite(character=char, draft=draft, twin=twin)

    return _finish(
        twin,
        [
            _msg("text", char["id"], rewritten["text"]),
            _msg(
                "build",
                char["id"],
                "Let's assemble our build! Tap the parts in order:",
                {"conceptId": start["id"], "parts": start.get("virtualBuild") or ["battery", "wire", "load"]},
            ),
        ],
        [qr("✅ I finished the build!", "build_done"), *get_persistent_quick_replies()],
        {
            "intent": "session_init",
            "concept": start["id"],
            "character": char["id"],
            "alternatives": routing["alternatives"] if routing else [],
            "level": _level_of(twin, start["id"]),
            "reason": f"Initial session initialized with {char['name']} for {start['name']}",
            "provider": rewritten["provider"],
        },
        log_reason=f"Initial session matched concept {start['name']} to character {char['name']}",
    )
