import os
from dotenv import load_dotenv

# Load env variables from .env
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

PORT = int(os.getenv("PORT", "8000"))
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-oss-120b:free")
SESSIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "sessions.json")
