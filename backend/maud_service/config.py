"""Settings for the maud-ai HTTP service.

Everything is env-overridable so the service can move between boxes without
code changes. Defaults match the current /opt/maud-ai deployment.
"""

import os


def _str(key: str, fallback: str) -> str:
    value = os.environ.get(key, "")
    return value.strip() if value.strip() else fallback


def _int(key: str, fallback: int) -> int:
    try:
        value = int(os.environ[key])
    except (KeyError, ValueError):
        return fallback
    return value if value > 0 else fallback


def _list(key: str, fallback: list[str]) -> list[str]:
    raw = os.environ.get(key, "")
    items = [part.strip() for part in raw.split(",") if part.strip()]
    return items or fallback


# --- Qdrant ---------------------------------------------------------------
QDRANT_HOST = _str("QDRANT_HOST", "localhost")
QDRANT_PORT = _int("QDRANT_PORT", 6333)
QDRANT_COLLECTION = _str("QDRANT_COLLECTION", "hr-documents")

# --- Embeddings -----------------------------------------------------------
EMBEDDING_MODEL = _str("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
EMBEDDING_DEVICE = _str("EMBEDDING_DEVICE", "cpu")

# --- vLLM (OpenAI-compatible) --------------------------------------------
VLLM_BASE_URL = _str("VLLM_BASE_URL", "http://localhost:8000/v1").rstrip("/")
MODEL_NAME = _str("MODEL_NAME", "google/gemma-3-1b-it")
LLM_TIMEOUT_SECONDS = _int("LLM_TIMEOUT_SECONDS", 180)

# --- Retrieval / generation budgets --------------------------------------
# These defaults are sized for vLLM's --max-model-len 2048, which has to hold
# the system prompt, the history, the context block AND the answer. Rough
# budget at 2048: ~130 system + ~870 context + ~270 history + ~100 question,
# leaving room for the 256-token answer.
#
# 2048 is a tight window and it costs retrieval quality — only 2-3 chunks fit.
# gemma-3-1b supports far more, so restarting vLLM with a larger window is the
# real fix; raise MAX_CONTEXT_CHARS alongside it. See backend/README.md.
MAX_CONTEXT_CHARS = _int("MAX_CONTEXT_CHARS", 2600)
MAX_OUTPUT_TOKENS = _int("MAX_OUTPUT_TOKENS", 256)

# Conversational memory. Kept deliberately short: on a small window, history
# competes with the retrieved context, and the context is what grounds the
# answer.
MAX_HISTORY_TURNS = _int("MAX_HISTORY_TURNS", 2)
MAX_HISTORY_CHARS = _int("MAX_HISTORY_CHARS", 400)
MAX_CONTEXT_CHUNKS = _int("MAX_CONTEXT_CHUNKS", 5)
PTO_CONTEXT_CHUNKS = _int("PTO_CONTEXT_CHUNKS", 4)
SEARCH_LIMIT = _int("SEARCH_LIMIT", 10)

# --- Service --------------------------------------------------------------
HOST = _str("HOST", "0.0.0.0")
PORT = _int("PORT", 8100)
# Origins allowed to call this service from a browser. The Next.js frontend
# proxies server-side, so this only matters for direct browser access.
CORS_ORIGINS = _list("CORS_ORIGINS", ["*"])
