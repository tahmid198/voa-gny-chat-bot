"""Stubs so the service can be tested without Qdrant, vLLM or a 400MB
embedding model. The stub modules must be registered before maud_service is
imported, since it imports both at module scope.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FakePoint:
    def __init__(self, file: str, chunk: str, text: str, score: float, path: str = ""):
        self.payload = {
            "file": file,
            "chunkID": chunk,
            "text": text,
            # ingest_documents.py records both; `path` is what identifies a
            # document, since `file` is only the basename.
            "path": path or f"/opt/maud-ai/documents/{file}",
        }
        self.score = score

    @property
    def text(self) -> str:
        return self.payload["text"]


class FakeQueryResponse:
    def __init__(self, points):
        self.points = points


class FakeQdrantClient:
    """Returns whatever is in `points` for every query, regardless of vector."""

    points: list[FakePoint] = []

    def __init__(self, *_args, **_kwargs):
        self.queries: list[list[float]] = []

    def query_points(self, collection_name, query, limit, with_payload=True):
        self.queries.append(query)
        return FakeQueryResponse(list(type(self).points)[:limit])

    def scroll(self, collection_name, limit, offset, with_payload, with_vectors):
        # One page, then stop.
        if offset is not None:
            return [], None
        return list(type(self).points), None


class FakeEncoding(list):
    def tolist(self):
        return list(self)


class FakeSentenceTransformer:
    def __init__(self, *_args, **_kwargs):
        pass

    def encode(self, text, normalize_embeddings=True):
        # Deterministic, cheap, and irrelevant — the fake client ignores it.
        return FakeEncoding([float(len(text) % 7), 0.5, 0.25])


qdrant_stub = types.ModuleType("qdrant_client")
qdrant_stub.QdrantClient = FakeQdrantClient
sys.modules.setdefault("qdrant_client", qdrant_stub)

st_stub = types.ModuleType("sentence_transformers")
st_stub.SentenceTransformer = FakeSentenceTransformer
sys.modules.setdefault("sentence_transformers", st_stub)


# --- Fixtures -------------------------------------------------------------

PTO_TABLE = (
    "PAID TIME OFF\n"
    "Years of employment | Hours per month | Hours per year | Workdays per year\n"
    "1st year 8.67 hours per month 104 hours 13 workdays\n"
    "2nd year 10.67 hours per month 128 hours 16 workdays\n"
    "3rd year 12.67 hours per month 152 hours 19 workdays\n"
    "4th year 14.67 hours per month 172 hours 22 workdays\n"
    "6th year 16.00 hours per month 192 hours 24 workdays\n"
    "11th year 17.33 hours per month 208 hours 26 workdays\n"
    "16th year 18.67 hours per month 224 hours 28 workdays\n"
    "21st year 20.00 hours per month 240 hours 30 workdays\n"
    "26th year 21.33 hours per month 256 hours 32 workdays\n"
    "31st year 22.67 hours per month 272 hours 34 workdays\n"
)


@pytest.fixture
def pto_points():
    return [
        # Prose about time off that the vector search likes better than the
        # table — this is exactly the case the lexical bonus exists to fix.
        FakePoint(
            "handbook.pdf",
            "12",
            "Employees are encouraged to use their paid time off each year. "
            "Requests for vacation should be submitted to your supervisor.",
            0.91,
        ),
        FakePoint("handbook.pdf", "44", PTO_TABLE, 0.62),
    ]


@pytest.fixture
def prose_points():
    return [
        FakePoint(
            "handbook.pdf",
            "80",
            "Bereavement leave of up to three days is available to employees "
            "following the death of an immediate family member.",
            0.88,
        ),
    ]
