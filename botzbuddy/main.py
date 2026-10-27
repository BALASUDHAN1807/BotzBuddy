"""FastAPI REST API for BotzBuddy (for integrating the engine into other apps).

The learner-facing app is the Streamlit UI (see streamlit_app.py).
Run the API with:  uvicorn botzbuddy.main:app --reload --port 8000
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
from pydantic import BaseModel, ConfigDict

from . import __version__, service
from .config import env, general_stem_default, has_key
from .registry import data_fingerprint, get_all_characters, get_all_concepts, get_all_profiles, reload_all
from .storage import get_curiosity_jar_summary
from .utils import iso_now

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("botzbuddy")

CLEANUP_INTERVAL_S = 15 * 60
HOT_RELOAD_INTERVAL_S = 1.0
MAX_BODY_BYTES = 50 * 1024
MAX_PHOTO_BYTES = 8 * 1024 * 1024


async def _session_janitor() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_S)
        service.cleanup_old_sessions()


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
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t


app = FastAPI(title="BotzBuddy Adaptive Engine API", version=__version__, lifespan=lifespan)

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


def _error(message: str, err: Exception, status: int = 500) -> JSONResponse:
    log.exception("%s", message)
    return JSONResponse({"error": message, "details": str(err)}, status_code=status)


# --------------------------------------------------------------------- routes
@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse("/docs")


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "BotzBuddy Adaptive Engine",
        "version": __version__,
        "timestamp": iso_now(),
        "generalStemModeDefault": general_stem_default(),
        "activeSessions": len(service.sessions),
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
        return await service.create_session(
            context=body.context,
            profile_id=body.profileId,
            age=body.age,
            interests=body.interests,
            knowledge=body.knowledge,
            language=body.language,
            character_id=body.characterId,
            product_slug=body.productSlug,
            short_mode=bool(body.shortMode),
            wants_depth=bool(body.wantsDepth),
            explorer=bool(body.explorer),
            general_stem=service.stem_flag(body.generalStem),
        )
    except Exception as err:  # noqa: BLE001
        return _error("Failed to initialize session", err)


@app.get("/api/teacher/sessions")
async def teacher_sessions(context: str | None = None):
    try:
        rows = service.teacher_sessions(context)
        return {"ok": True, "context": context or "all", "count": len(rows), "sessions": rows}
    except Exception as err:  # noqa: BLE001
        return _error("Failed to fetch teacher sessions", err)


@app.post("/api/chat")
async def chat(body: ChatRequest):
    if not body.sessionId:
        return JSONResponse({"error": "Missing sessionId"}, status_code=400)
    try:
        return await service.chat(body.sessionId, body.text or "", body.action, service.stem_flag(body.generalStem))
    except Exception as err:  # noqa: BLE001
        return _error("Failed to process message", err)


@app.get("/api/curiosity-jar")
async def curiosity_jar():
    try:
        return get_curiosity_jar_summary()
    except Exception as err:  # noqa: BLE001
        return _error("Failed to retrieve curiosity jar", err)


@app.post("/api/photo-check")
async def photo_check(body: PhotoCheckRequest):
    try:
        result = await service.photo_check(body.sessionId, body.image or "", body.concept)
        result.pop("state", None)
        return result
    except Exception as err:  # noqa: BLE001
        log.exception("[API /api/photo-check] Error")
        return JSONResponse(
            {"ok": False, "feedback": service.FALLBACK_PHOTO_TEXT, "error": str(err)}, status_code=500
        )


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


def run() -> None:
    """Console entry point for the API: ``python -m botzbuddy``."""
    import uvicorn

    uvicorn.run(
        "botzbuddy.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("API_PORT", "8000")),
        reload=os.environ.get("RELOAD", "").lower() in ("1", "true", "yes"),
    )
