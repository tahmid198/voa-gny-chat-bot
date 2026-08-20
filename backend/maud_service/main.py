"""FastAPI wrapper around the maud-ai RAG pipeline.

Retrieval needs the BAAI/bge-base-en-v1.5 embedding model to turn a question
into a query vector, and that only exists in Python — which is why this
service sits between the Next.js frontend and Qdrant/vLLM rather than the
frontend talking to them directly.

Run with:  uvicorn maud_service.main:app --host 0.0.0.0 --port 8100
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from anyio import to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

from . import __version__, config, llm, pto, retrieval

logger = logging.getLogger("maud_service")

# Populated on startup.
state: dict[str, Any] = {"embedder": None, "qdrant": None}

# Cached document inventory; Qdrant is scrolled in full to build it.
_documents_cache: dict[str, Any] | None = None
_documents_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Loading embedding model %s...", config.EMBEDDING_MODEL)
    state["embedder"] = SentenceTransformer(
        config.EMBEDDING_MODEL, device=config.EMBEDDING_DEVICE
    )
    state["qdrant"] = QdrantClient(host=config.QDRANT_HOST, port=config.QDRANT_PORT)
    logger.info("Ready on %s:%s", config.HOST, config.PORT)
    yield


app = FastAPI(title="maud-ai", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class HistoryTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    history: list[HistoryTurn] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _embed(text: str) -> list[float]:
    return state["embedder"].encode(text, normalize_embeddings=True).tolist()


def _search(question: str, previous_question: str | None) -> retrieval.Retrieval:
    return retrieval.search(state["qdrant"], _embed, question, previous_question)


def _previous_question(history: list[HistoryTurn]) -> str | None:
    for turn in reversed(history):
        if turn.role == "user" and turn.content.strip():
            return turn.content.strip()
    return None


def _scan_collection() -> dict[str, Any]:
    """Walk every point in the collection to inventory the ingested files."""
    client: QdrantClient = state["qdrant"]

    chunk_counts: dict[str, int] = defaultdict(int)
    char_counts: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    total = 0
    offset = None

    while True:
        points, offset = client.scroll(
            collection_name=config.QDRANT_COLLECTION,
            limit=512,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        for point in points:
            payload = point.payload or {}
            file_name = str(payload.get("file", "Unknown"))
            # Group by path, not name: ingest_documents.py stores `file` as the
            # bare name, so same-named files in different subfolders would
            # otherwise collapse into one entry and undercount the total.
            path = retrieval.relative_path(str(payload.get("path", "")), file_name)
            names[path] = file_name
            chunk_counts[path] += 1
            char_counts[path] += len(payload.get("text", "") or "")
            total += 1

        if offset is None:
            break

    files = [
        {
            "file": names[path],
            "path": path,
            "chunkCount": chunk_counts[path],
            "charCount": char_counts[path],
        }
        for path in sorted(chunk_counts)
    ]

    return {
        "collection": config.QDRANT_COLLECTION,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "fileCount": len(files),
        "chunkCount": total,
        "files": files,
        "errors": [],
    }


async def _documents(force: bool = False) -> dict[str, Any]:
    global _documents_cache

    async with _documents_lock:
        if _documents_cache is not None and not force:
            return _documents_cache

        try:
            _documents_cache = await to_thread.run_sync(_scan_collection)
        except Exception as error:  # noqa: BLE001 - reported to the frontend
            logger.warning("Collection scan failed: %s", error)
            return {
                "collection": config.QDRANT_COLLECTION,
                "builtAt": datetime.now(timezone.utc).isoformat(),
                "fileCount": 0,
                "chunkCount": 0,
                "files": [],
                "errors": [
                    f'Could not read Qdrant collection "{config.QDRANT_COLLECTION}" '
                    f"at {config.QDRANT_HOST}:{config.QDRANT_PORT}: {error}"
                ],
            }

        return _documents_cache


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    documents = await _documents()

    try:
        models = await llm.list_models()
        model_available = any(
            model == config.MODEL_NAME or model.split(":")[0] == config.MODEL_NAME
            for model in models
        )
        llm_status: dict[str, Any] = {
            "online": True,
            "models": models,
            "modelAvailable": model_available,
        }
    except Exception as error:  # noqa: BLE001 - reported to the frontend
        llm_status = {
            "online": False,
            "models": [],
            "modelAvailable": False,
            "error": llm.describe_error(error),
        }

    return {
        "service": {"version": __version__},
        "llm": {
            **llm_status,
            "host": config.VLLM_BASE_URL,
            "model": config.MODEL_NAME,
        },
        "vectorStore": {
            "host": f"{config.QDRANT_HOST}:{config.QDRANT_PORT}",
            "collection": config.QDRANT_COLLECTION,
            "online": not documents["errors"],
            "embeddingModel": config.EMBEDDING_MODEL,
        },
        "documents": {
            "collection": documents["collection"],
            "fileCount": documents["fileCount"],
            "chunkCount": documents["chunkCount"],
            "errors": documents["errors"],
        },
    }


@app.get("/documents")
async def documents() -> dict[str, Any]:
    return await _documents()


@app.post("/documents/refresh")
async def refresh_documents() -> dict[str, Any]:
    return await _documents(force=True)


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """Newline-delimited JSON: one {"type": ...} object per line."""

    async def events() -> AsyncIterator[bytes]:
        def line(payload: dict[str, Any]) -> bytes:
            return (json.dumps(payload) + "\n").encode("utf-8")

        question = request.question.strip()
        if not question:
            yield line({"type": "error", "message": "A question is required."})
            return

        try:
            result = await to_thread.run_sync(
                _search, question, _previous_question(request.history)
            )
        except Exception as error:  # noqa: BLE001 - reported to the frontend
            logger.exception("Retrieval failed")
            yield line({"type": "error", "message": f"Search failed: {error}"})
            return

        if not result.hits:
            message = result.errors[0] if result.errors else None
            if message:
                yield line({"type": "error", "message": message})
                return

            yield line({"type": "sources", "sources": []})
            yield line(
                {
                    "type": "delta",
                    "text": (
                        "The information is unavailable in the supplied HR "
                        "documents. Try different wording, or check that the "
                        "relevant document has been ingested."
                    ),
                }
            )
            yield line({"type": "done"})
            return

        yield line(
            {
                "type": "sources",
                "sources": [
                    {
                        "n": position,
                        "file": hit.file,
                        "path": hit.path,
                        "chunk": hit.chunk,
                        "snippet": hit.snippet,
                        "score": round(hit.score, 4),
                    }
                    for position, hit in enumerate(result.hits, start=1)
                ],
            }
        )

        # A parsed PTO table beats anything a 1B model will say about it.
        if result.is_pto_question:
            direct = pto.answer(question, result.hits)
            if direct:
                yield line({"type": "delta", "text": direct})
                yield line({"type": "done"})
                return

        messages = llm.build_messages(
            question, result.hits, [turn.model_dump() for turn in request.history]
        )

        try:
            async for delta in llm.stream_chat(messages):
                yield line({"type": "delta", "text": delta})
        except Exception as error:  # noqa: BLE001 - reported to the frontend
            logger.exception("vLLM request failed")
            yield line({"type": "error", "message": llm.describe_error(error)})
            return

        yield line({"type": "done"})

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def run() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    run()
