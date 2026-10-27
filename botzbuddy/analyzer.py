"""Teach-back analysis: LLM first, keyword heuristics as fallback."""

from __future__ import annotations

from .llm import analyze_with_llm


def _empty() -> dict:
    return {
        "understood": "none",
        "keyIdeasCovered": [],
        "misconceptionId": None,
        "fix": None,
        "wantsSwitchCharacter": None,
        "newInterest": None,
        "provider": "keyword-fallback",
    }


def analyze_keywords(user_input: str | None, concept: dict | None) -> dict:
    if not user_input or not concept:
        return _empty()

    text = user_input.lower()

    found_misc = None
    fix_text = None
    for misc in concept.get("misconceptions") or []:
        if any(p.lower() in text for p in misc.get("patterns") or []):
            found_misc = misc["id"]
            fix_text = misc.get("fix")
            break

    covered = [
        ki["id"]
        for ki in concept.get("keyIdeas") or []
        if any(term.lower() in text for term in ki.get("terms") or [])
    ]

    total = len(concept.get("keyIdeas") or []) or 1
    ratio = len(covered) / total

    understood = "none"
    if ratio >= 0.6:
        understood = "strong"
    elif covered:
        understood = "partial"

    if any(w in text for w in ("loop", "circle", "bounce", "reflect", "spin", "convert")) and understood == "none":
        understood = "partial"

    result = _empty()
    result.update(
        understood=understood,
        keyIdeasCovered=covered,
        misconceptionId=found_misc,
        fix=fix_text,
    )
    return result


async def analyze_teach_back(*, user_input: str, concept: dict | None, character: dict | None = None) -> dict:
    if not user_input or not concept:
        return analyze_keywords(user_input, concept)

    try:
        llm_result = await analyze_with_llm(user_input=user_input, concept=concept, character=character)
    except Exception:  # noqa: BLE001
        llm_result = None

    if llm_result:
        fix = None
        if llm_result.get("misconceptionId"):
            match = next(
                (m for m in concept.get("misconceptions") or [] if m["id"] == llm_result["misconceptionId"]),
                None,
            )
            if match:
                fix = match.get("fix")
        return {**llm_result, "fix": fix}

    return analyze_keywords(user_input, concept)
