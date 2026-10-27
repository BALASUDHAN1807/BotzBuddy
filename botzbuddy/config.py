"""Environment configuration (loaded from .env when present)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
PUBLIC_DIR = ROOT_DIR / "public"

load_dotenv(ROOT_DIR / ".env")


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def has_key(name: str) -> bool:
    return bool(env(name))


DEFAULT_GEMINI_MODEL = "gemini-flash-latest"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


def general_stem_default() -> str:
    return os.environ.get("GENERAL_STEM_MODE") or "on"
