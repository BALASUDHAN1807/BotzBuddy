"""FastAPI application: REST API for the BotzBuddy plugin plus static demo pages.

Run with:  uvicorn botzbuddy.main:app --reload --port 3000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import __version__
from .brain import initialize_session, process_message
from .config import PUBLIC_DIR, env, general_stem_default, has_key
from .llm import photo_check_vision
from .registry import (
    data_fingerprint,
    get_all_characters,
    get_all_concepts,
    get_all_profiles,
    get_character,
    get_concept,
    reload_all,
)
from .storage import get_curiosity_jar_summary
from .twin import LearningTwin
from .utils import iso_now, now_ms

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("botzbuddy")

SESSION_TTL_MS = 2 * 60 * 60 * 1000
CLEANUP_INTERVAL_S = 15 * 60
HOT_RELOAD_INTERVAL_S = 1.0
MAX_BODY_BYTES = 50 * 1024
MAX_PHOTO_BYTES = 8 * 1024 * 1024

sessions: dict[str, LearningTwin] = {}


# ------------------------------------------------------------ background tasks
def cleanup_old_sessions() -> int:
    cutoff = now_ms() - SESSION_TTL_MS
    stale = [sid for sid, twin in sessions.items() if twin.last_active_at < cutoff]
    for sid in stale:
        sessions.pop(sid, None)
    return len(stale)


async def _session_janitor() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_S)
        cleanup_old_sessions()


async def _hot_reload_watcher() -> None:
    """Reload characters/concepts/profiles when any JSON file in data/ changes."""
    last = data_fingerprint()
    while True:
        await asyncio.sleep(HOT_RELOAD_INTERVAL_S)
        current = data_fingerprint()
        if current != last:
            last = current
            log.info("[Registry] Hot-reload triggered by data change")
            reload_all()


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(_session_janitor()), asyncio.create_task(_hot_reload_watcher())]
    port = os.environ.get("PORT", "3000")
    log.info("🤖 BotzBuddy running — demo hub at http://localhost:%s/demo/", port)
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t


app = FastAPI(title="BotzBuddy Adaptive Engine", version=__version__, lifespan=lifespan)

_origins = env("ALLOWED_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    limit = MAX_PHOTO_BYTES if request.url.path == "/api/photo-check" else MAX_BODY_BYTES
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > limit:
        return JSONResponse({"error": "Request body too large"}, status_code=413)
    return await call_next(request)


# ------------------------------------------------------------------- schemas
class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    context: str | None = None
    profileId: str | None = None
    age: Any = None
    interests: list[str] | None = None
    knowledge: str | None = None
    language: str | None = None
    characterId: str | None = None
    productSlug: str | None = None
    shortMode: bool | None = None
    wantsDepth: bool | None = None
    explorer: bool | None = None
    generalStem: Any = None
    generalStemMode: Any = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    sessionId: str | None = None
    text: str | None = ""
    action: dict[str, Any] | None = None
    generalStem: Any = None


class PhotoCheckRequest(BaseModel):
    sessionId: str | None = None
    image: str | None = None
    concept: str | None = None


def _stem_flag(value: Any) -> bool:
    return value == "on" or value is True


def _general_stem_from(body: BaseModel) -> Any:
    fields = body.model_fields_set
    if "generalStem" in fields:
        return _stem_flag(body.generalStem)
    if "generalStemMode" in fields:
        return getattr(body, "generalStemMode", None)
    return None


def _error(message: str, err: Exception, status: int = 500) -> JSONResponse:
    log.exception("%s", message)
    return JSONResponse({"error": message, "details": str(err)}, status_code=status)


# --------------------------------------------------------------------- routes
@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse("/demo/")


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "BotzBuddy Adaptive Engine",
        "version": __version__,
        "timestamp": iso_now(),
        "generalStemModeDefault": general_stem_default(),
        "activeSessions": len(sessions),
        "providers": {
            "openai": has_key("OPENAI_API_KEY"),
            "gemini": has_key("GEMINI_API_KEY"),
            "groq": has_key("GROQ_API_KEY"),
            "ruleBasedFallback": True,
        },
    }


CHARACTER_FIELDS = (
    "id", "name", "group", "status", "role", "emoji", "color", "avatarUrl", "facts",
    "concepts", "productSlug", "kitUrl", "voiceStyle", "interestTags",
)


@app.get("/api/characters")
async def characters() -> list[dict]:
    return [{k: c.get(k) for k in CHARACTER_FIELDS} for c in get_all_characters()]


@app.get("/api/concepts")
async def concepts() -> list[dict]:
    return get_all_concepts()


@app.get("/api/profiles")
async def profiles() -> list[dict]:
    return get_all_profiles()


@app.post("/api/session")
async def create_session(body: SessionRequest):
    try:
        twin = LearningTwin(
            context=body.context or "home",
            profile_id=body.profileId,
            age=body.age if body.age is not None else 9,
            interests=body.interests,
            knowledge=body.knowledge or "new",
            language=body.language or "en",
            character_id=body.characterId,
            short_mode=bool(body.shortMode),
            wants_depth=bool(body.wantsDepth),
            explorer=bool(body.explorer),
            general_stem_mode=_general_stem_from(body),
        )
        sessions[twin.session_id] = twin
        result = await initialize_session(twin=twin, character_slug=body.productSlug or body.characterId)
        return {"sessionId": twin.session_id, **result}
    except Exception as err:  # noqa: BLE001
        return _error("Failed to initialize session", err)


@app.get("/api/teacher/sessions")
async def teacher_sessions(context: str | None = None):
    try:
        active = []
        idx = 1
        for twin in list(sessions.values()):
            if not context or context == "all" or twin.context == context:
                active.append(twin.to_teacher_summary(idx))
                idx += 1
        return {"ok": True, "context": context or "all", "count": len(active), "sessions": active}
    except Exception as err:  # noqa: BLE001
        return _error("Failed to fetch teacher sessions", err)


@app.post("/api/chat")
async def chat(body: ChatRequest):
    if not body.sessionId:
        return JSONResponse({"error": "Missing sessionId"}, status_code=400)
    try:
        twin = sessions.get(body.sessionId)
        stem = _general_stem_from(body)
        if twin is None:  # expired or unknown session: start a fresh twin under the same id
            twin = LearningTwin(session_id=body.sessionId, general_stem_mode=stem)
            sessions[body.sessionId] = twin
        elif stem is not None:
            twin.general_stem_mode = stem
        return await process_message(twin=twin, text=body.text or "", action=body.action)
    except Exception as err:  # noqa: BLE001
        return _error("Failed to process message", err)


@app.get("/api/curiosity-jar")
async def curiosity_jar():
    try:
        return get_curiosity_jar_summary()
    except Exception as err:  # noqa: BLE001
        return _error("Failed to retrieve curiosity jar", err)


FALLBACK_PHOTO_TEXT = "I can't see photos right now, but tell me what you built!"


@app.post("/api/photo-check")
async def photo_check(body: PhotoCheckRequest):
    try:
        twin = sessions.get(body.sessionId or "")
        if twin is None:
            twin = LearningTwin(session_id=body.sessionId)
            sessions[twin.session_id] = twin

        all_chars = get_all_characters()
        character = (
            get_character(twin.current_character or "quacky")
            or next((c for c in all_chars if c.get("status") == "verified"), None)
            or all_chars[0]
        )
        concept = get_concept(body.concept or twin.current_concept) or get_all_concepts()[0]

        provider = "rule-based"
        try:
            feedback = await photo_check_vision(
                image_base64=body.image or "", concept=concept, character=character, age=twin.age or 9
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
        }
    except Exception as err:  # noqa: BLE001
        log.exception("[API /api/photo-check] Error")
        return JSONResponse({"ok": False, "feedback": FALLBACK_PHOTO_TEXT, "error": str(err)}, status_code=500)


@app.post("/api/admin/reload")
async def admin_reload():
    reload_all()
    return {
        "ok": True,
        "reloadedAt": iso_now(),
        "charactersCount": len(get_all_characters()),
        "conceptsCount": len(get_all_concepts()),
        "profilesCount": len(get_all_profiles()),
    }


# Static plugin + demo pages (mounted last so /api routes win)
app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")


def run() -> None:
    """Console entry point: ``python -m botzbuddy``."""
    import uvicorn

    uvicorn.run(
        "botzbuddy.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "3000")),
        reload=os.environ.get("RELOAD", "").lower() in ("1", "true", "yes"),
    )
