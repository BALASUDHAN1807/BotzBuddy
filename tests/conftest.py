import os
import sys
from pathlib import Path

# Tests run fully rule-based: blank out any LLM keys so no network calls are made.
for key in ("GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "MONGODB_URI"):
    os.environ[key] = ""

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
