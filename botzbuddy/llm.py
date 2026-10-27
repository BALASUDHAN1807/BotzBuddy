"""LLM integration layer: OpenAI, Google Gemini and Groq over HTTPX.

Every chain falls back gracefully, so BotzBuddy works fully rule-based with no API keys.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from .config import DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, DEFAULT_OPENAI_MODEL, env
from .registry import get_all_characters

log = logging.getLogger("botzbuddy.llm")

TIMEOUT_S = 12.0
OPENAI_TIMEOUT_S = 8.0


class LLMError(RuntimeError):
    pass


async def _post_json(url: str, body: dict, headers: dict | None = None, timeout: float = TIMEOUT_S) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, json=body, headers=headers or {})


# ------------------------------------------------------------------ providers
async def call_openai(prompt: str, system_instruction: str = "", json_mode: bool = False) -> str:
    api_key = env("OPENAI_API_KEY")
    if not api_key:
        raise LLMError("OpenAI API key not configured")

    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})

    body: dict[str, Any] = {
        "model": env("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 350,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    res = await _post_json(
        "https://api.openai.com/v1/chat/completions",
        body,
        {"Authorization": f"Bearer {api_key}"},
        OPENAI_TIMEOUT_S,
    )
    if res.status_code >= 400:
        raise LLMError(f"OpenAI API error {res.status_code}: {res.text[:150]}")
    text = (((res.json().get("choices") or [{}])[0]).get("message") or {}).get("content")
    if not text:
        raise LLMError("OpenAI returned empty response")
    return text.strip()


async def call_gemini(prompt: str, system_instruction: str = "", json_mode: bool = False) -> str:
    api_key = env("GEMINI_API_KEY")
    if not api_key:
        raise LLMError("Gemini API key not configured")

    model = env("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 600,
            "responseMimeType": "application/json" if json_mode else "text/plain",
        },
    }
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    res = await _post_json(url, body, {"x-goog-api-key": api_key})
    if res.status_code >= 400:
        raise LLMError(f"Gemini API error {res.status_code}: {res.text[:150]}")
    return _gemini_text(res.json())


def _gemini_text(data: dict) -> str:
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        text = None
    if not text:
        raise LLMError("Gemini returned empty candidate")
    return text.strip()


async def call_groq(prompt: str, system_instruction: str = "", json_mode: bool = False) -> str:
    api_key = env("GROQ_API_KEY")
    if not api_key:
        raise LLMError("Groq API key not configured")

    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})
    body = {
        "model": env("GROQ_MODEL", DEFAULT_GROQ_MODEL),
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 600,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    url = "https://api.groq.com/openai/v1/chat/completions"

    res = await _post_json(url, body, headers)
    if res.status_code >= 400 and json_mode:
        try:  # one retry for transient errors on JSON calls
            retry = await _post_json(url, body, headers)
            if retry.status_code < 400:
                res = retry
        except httpx.HTTPError:
            pass
    if res.status_code >= 400:
        raise LLMError(f"Groq API error {res.status_code}: {res.text[:150]}")
    text = (((res.json().get("choices") or [{}])[0]).get("message") or {}).get("content")
    if not text:
        raise LLMError("Groq returned empty response")
    return text.strip()


def safe_parse_json(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except ValueError:
                return None
    return None


# ---------------------------------------------------------- talker grounding
def validate_talker_output(output: Any, draft: str, character: dict, all_characters: list[dict]) -> bool:
    if not output or not isinstance(output, str):
        return False
    trimmed = output.strip()
    if not trimmed or len(trimmed) > 900:
        return False
    draft_lower = (draft or "").lower()
    out_lower = trimmed.lower()
    for other in all_characters:
        if other["id"] == character["id"]:
            continue
        name = other["name"].lower()
        if name in out_lower and name not in draft_lower:
            log.warning("[Grounding] Talker hallucinated character name '%s'. Rejecting.", other["name"])
            return False
    return True


async def talker_rewrite(*, character: dict, draft: str, twin: Any) -> dict:
    """Rewrite a rule-based draft in the character's voice: Gemini -> OpenAI -> Groq -> draft."""
    if not draft or not draft.strip():
        return {"text": draft, "provider": "rule-based"}

    age = getattr(twin, "age", 9) or 9
    is_short = getattr(twin, "short_mode", False) or getattr(twin, "age_band", "") == "young"
    facts = "; ".join(character.get("facts") or []) or "No extra facts."
    lang = getattr(twin, "language", "en") or "en"

    length_rule = (
        "Keep it very short (1-2 friendly sentences max, around 20-30 words)."
        if is_short
        else "Keep it concise and punchy (2-4 sentences max, around 40-60 words)."
    )
    lang_rule = (
        "Translate into simple, encouraging Tamil for children. Keep technical words like LED, motor, battery, circuit, sensor in English transliteration/terms."
        if lang == "ta"
        else "Language: English."
    )
    system_instruction = f"""You are {character['name']}, a Funobotz paper-robot STEM friend talking to a {age}-year-old child.
Voice style: {character.get('voiceStyle')}.
CRITICAL CONSTRAINTS:
1. Rewrite the DRAFT message only. Preserve the core instructional meaning and instructions.
2. DO NOT add new scientific facts, character lore, backstories, superpowers, or physical features not in the draft or approved facts.
3. Approved Funobotz character facts: {facts}. Never invent facts about other characters.
4. {length_rule}
5. Encourage hands-on discovery and curiosity.
6. Never ask for personal information (names, emails, locations).
7. Return plain text only without markdown backticks or greetings.
8. {lang_rule}"""
    prompt = f"DRAFT:\n{draft}\n\nRewrite with {character['name']}'s voice:"
    all_chars = get_all_characters()

    for provider, fn in (("gemini", call_gemini), ("openai", call_openai), ("groq", call_groq)):
        try:
            text = await fn(prompt, system_instruction, False)
            if validate_talker_output(text, draft, character, all_chars):
                return {"text": text, "provider": provider}
        except Exception:  # noqa: BLE001 - fall through to next provider
            continue

    final = draft
    if lang == "ta":
        final = f"{draft} (Tamil mode: connect Gemini or Groq API key in .env for dynamic translation)"
    return {"text": final, "provider": "rule-based"}


# ------------------------------------------------------------ analyzer chain
async def analyze_with_llm(*, user_input: str, concept: dict, character: dict | None = None) -> dict | None:
    """Teach-back analysis: Groq -> OpenAI -> Gemini -> None (caller uses keywords)."""
    key_ideas = concept.get("keyIdeas") or []
    misconceptions = concept.get("misconceptions") or []
    allowed_ki = [k["id"] for k in key_ideas]
    allowed_mc = [m["id"] for m in misconceptions]

    system_instruction = f"""You are a strict JSON learning analyzer for children's STEM explanations.
Evaluate the child's teach-back explanation for the concept "{concept['name']}".
Key ideas expected: {json.dumps(key_ideas, ensure_ascii=False)}
Known misconceptions: {json.dumps(misconceptions, ensure_ascii=False)}

You must return ONLY a JSON object matching this schema:
{{
  "understood": "strong" | "partial" | "none",
  "keyIdeasCovered": [string],
  "misconceptionId": string | null,
  "wantsSwitchCharacter": string | null,
  "newInterest": string | null
}}
Constraints:
- "understood" is "strong" if >=60% of key ideas are conveyed, "partial" if at least 1 key idea or positive understanding is conveyed, "none" if confused or unrelated.
- "keyIdeasCovered" must ONLY contain valid IDs from: {json.dumps(allowed_ki)}.
- "misconceptionId" must ONLY be one of: {json.dumps(allowed_mc)}, or null if no misconception.
- "wantsSwitchCharacter" is the character name if the child asks to talk to another robot (e.g., "Quacky", "Tiko", "Tolly", "Petalo", "Emoti"), else null.
- "newInterest" is a concept keyword if the child changed their mind, else null."""
    prompt = f'Child\'s response: "{user_input}"\n\nAnalyze and return JSON:'

    for provider, fn in (("groq", call_groq), ("openai", call_openai), ("gemini", call_gemini)):
        try:
            parsed = json.loads(await fn(prompt, system_instruction, True))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(parsed, dict):
            return {
                "understood": parsed.get("understood") if parsed.get("understood") in ("strong", "partial", "none") else "partial",
                "keyIdeasCovered": [i for i in (parsed.get("keyIdeasCovered") or []) if i in allowed_ki],
                "misconceptionId": parsed.get("misconceptionId") if parsed.get("misconceptionId") in allowed_mc else None,
                "wantsSwitchCharacter": parsed.get("wantsSwitchCharacter") or None,
                "newInterest": parsed.get("newInterest") or None,
                "provider": provider,
            }
    return None


async def _json_chain(order, prompt: str, system_instruction: str, required_key: str) -> dict | None:
    for provider, fn in order:
        try:
            parsed = safe_parse_json(await fn(prompt, system_instruction, True))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(parsed, dict) and parsed.get(required_key):
            return {"data": parsed, "provider": provider}
    return None


async def call_explainer_llm(*, prompt: str, system_instruction: str) -> dict | None:
    """General-science explainer: OpenAI -> Gemini -> Groq -> None."""
    order = (("openai", call_openai), ("gemini", call_gemini), ("groq", call_groq))
    return await _json_chain(order, prompt, system_instruction, "answer")


async def call_classifier_llm(*, prompt: str, system_instruction: str) -> dict | None:
    """Question classifier: Groq -> OpenAI -> Gemini -> None."""
    order = (("groq", call_groq), ("openai", call_openai), ("gemini", call_gemini))
    return await _json_chain(order, prompt, system_instruction, "tier")


# ---------------------------------------------------------------- vision
async def photo_check_vision(*, image_base64: str, concept: dict, character: dict, age: float = 9) -> str:
    api_key = env("GEMINI_API_KEY")
    if not api_key:
        raise LLMError("Gemini API key not configured for vision check")
    if not image_base64 or not isinstance(image_base64, str):
        raise LLMError("No image supplied")

    raw = image_base64
    mime = "image/jpeg"
    if ";base64," in image_base64:
        head, raw = image_base64.split(";base64,", 1)
        mime = head.replace("data:", "") or "image/jpeg"

    key_ideas = ", ".join(k["id"] for k in (concept.get("keyIdeas") or []))
    system_instruction = (
        f"You are {character['name']}, an encouraging Funobotz paper-robot friend helping a {age}-year-old. "
        f'Look at this paper robotics build for the concept "{concept["name"]}". Give 2 short encouraging sentences: '
        f"one thing done well and one thing to check, using only these key ideas: {key_ideas}. "
        "Do not identify people or read personal details. If the image is not a paper build, kindly ask for a photo "
        "of their paper build. Return plain text only."
    )
    model = env("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": mime, "data": raw}},
                    {"text": f"Please check my paper robot build for {concept['name']}!"},
                ],
            }
        ],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300},
        "systemInstruction": {"parts": [{"text": system_instruction}]},
    }
    res = await _post_json(url, body, {"x-goog-api-key": api_key}, 10.0)
    if res.status_code >= 400:
        raise LLMError(f"Gemini Vision error: {res.status_code} {res.text[:100]}")
    return _gemini_text(res.json())
