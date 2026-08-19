"""Vector search over the Qdrant HR collection.

Ported from rag_chat.py. The two behaviours worth keeping from the CLI:

1. Short follow-ups ("what about after 10 years?") carry no useful embedding
   on their own, so they are fanned out into several queries using the
   previous turn.
2. The PTO accrual policy is table-shaped. Pure vector similarity ranks it
   poorly, so PTO questions get a lexical bonus on top of the vector score.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from qdrant_client import QdrantClient

from . import config

PTO_TRIGGERS = ("pto", "paid time off", "vacation", "days off")
PTO_FOLLOWUP_TRIGGERS = ("pto", "paid time off", "vacation")

# Each accrual tier as it is written in the handbook table. Used to steer the
# embedding towards the table rows rather than the surrounding prose.
PTO_TIER_QUERIES = [
    "Paid Time Off accrual hours per month workdays per year",
    "PTO first year 104 hours 13 workdays",
    "PTO second year 128 hours 16 workdays",
    "PTO third year 152 hours 19 workdays",
    "PTO fourth year 172 hours 22 workdays",
    "PTO sixth year 192 hours 24 workdays",
    "PTO eleventh year 208 hours 26 workdays",
    "PTO sixteenth year 224 hours 28 workdays",
    "PTO twenty first year 240 hours 30 workdays",
    "PTO twenty sixth year 256 hours 32 workdays",
    "PTO thirty first year 272 hours 34 workdays",
]

PTO_KEYWORDS = [
    "paid time off",
    "hours per month",
    "workdays per year",
    "first year",
    "2nd year",
    "second year",
    "3rd year",
    "third year",
    "4th year",
    "fourth year",
    "6th year",
    "11th year",
    "16th year",
    "21st year",
    "26th year",
    "31st year",
    "104 hours",
    "128 hours",
    "152 hours",
    "172 hours",
    "192 hours",
    "208 hours",
    "224 hours",
    "240 hours",
    "256 hours",
    "272 hours",
]

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "did", "do",
    "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "is",
    "it", "its", "me", "my", "of", "on", "or", "our", "so", "than", "that",
    "the", "their", "them", "then", "there", "these", "they", "this", "to",
    "was", "we", "were", "what", "when", "where", "which", "who", "why",
    "will", "with", "you", "your", "about", "please", "tell", "give",
}


@dataclass
class Hit:
    """One retrieved chunk, ready to be shown as a source or fed to the LLM."""

    file: str
    chunk: str
    text: str
    score: float
    snippet: str = ""


@dataclass
class Retrieval:
    hits: list[Hit] = field(default_factory=list)
    context: str = ""
    is_pto_question: bool = False
    errors: list[str] = field(default_factory=list)


def is_pto_question(question: str, previous_question: str | None = None) -> bool:
    """PTO intent, inherited from the previous turn for bare follow-ups."""
    if any(trigger in question.lower() for trigger in PTO_TRIGGERS):
        return True
    if previous_question and any(
        trigger in previous_question.lower() for trigger in PTO_FOLLOWUP_TRIGGERS
    ):
        return True
    return False


def build_queries(question: str, previous_question: str | None = None) -> list[str]:
    """Expand one user question into the set of vectors worth searching."""
    queries = [question]

    if previous_question:
        combined = f"{previous_question} {question}"
        if any(t in combined.lower() for t in PTO_FOLLOWUP_TRIGGERS):
            queries.append(
                "Paid Time Off PTO accrual workdays per year years of employment"
            )
            queries.append(combined)

    if any(trigger in question.lower() for trigger in PTO_TRIGGERS):
        queries.extend(PTO_TIER_QUERIES)

    # Preserve order while dropping duplicates.
    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        key = query.strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(query)
    return unique


def _lexical_bonus(text: str) -> float:
    """Reward chunks that literally contain the PTO table's vocabulary."""
    lowered = text.lower()
    bonus = 0.25 * sum(1 for keyword in PTO_KEYWORDS if keyword in lowered)

    # The table itself carries both column headers; that is the chunk we want.
    if "hours per month" in lowered and "workdays per year" in lowered:
        bonus += 1.0

    return bonus


def _query_terms(question: str) -> set[str]:
    return {
        word
        for word in _WORD_RE.findall(question.lower())
        if len(word) > 1 and word not in _STOPWORDS
    }


def make_snippet(text: str, terms: set[str], window: int = 40, limit: int = 240) -> str:
    """Pull the most relevant region of the chunk so the source card shows the
    part that actually matched.

    Windows are ranked by how many *distinct* query terms they contain before
    total occurrences. Raw frequency alone picks the wrong passage: asked about
    "bereavement leave", a paragraph saying "leave" four times outscores the one
    that actually defines bereavement leave, because the distinctive term is
    rare and the common one repeats.
    """
    words = text.split()
    if len(words) <= window + 5:
        return text[:limit].strip()

    # Normalize once; the scoring loop revisits each word up to window/step times.
    normalized = [
        match[0] if (match := _WORD_RE.findall(word.lower())) else "" for word in words
    ]

    best_start = 0
    best_score = (-1, -1)
    for start in range(0, len(normalized) - window + 1, 5):
        matched = [w for w in normalized[start : start + window] if w in terms]
        score = (len(set(matched)), len(matched))
        if score > best_score:
            best_score = score
            best_start = start

    snippet = " ".join(words[best_start : best_start + window])[:limit].strip()
    prefix = "… " if best_start > 0 else ""
    suffix = " …" if best_start + window < len(words) else ""
    return f"{prefix}{snippet}{suffix}"


def search(
    client: QdrantClient,
    embed,
    question: str,
    previous_question: str | None = None,
) -> Retrieval:
    """Run the expanded query set against Qdrant and assemble LLM context.

    `embed` takes a string and returns a normalized vector as a list of floats.
    """
    result = Retrieval(is_pto_question=is_pto_question(question, previous_question))

    candidates: list[Hit] = []
    seen: set[tuple[str, str]] = set()

    for query in build_queries(question, previous_question):
        try:
            points = client.query_points(
                collection_name=config.QDRANT_COLLECTION,
                query=embed(query),
                limit=config.SEARCH_LIMIT,
                with_payload=True,
            ).points
        except Exception as error:  # noqa: BLE001 - surfaced to the caller
            result.errors.append(f"Qdrant query failed: {error}")
            continue

        for point in points:
            payload = point.payload or {}
            file_name = str(payload.get("file", "Unknown"))
            chunk_id = str(payload.get("chunkID", "?"))
            text = payload.get("text", "") or ""

            key = (file_name, chunk_id)
            if key in seen or not text.strip():
                continue
            seen.add(key)

            candidates.append(
                Hit(
                    file=file_name,
                    chunk=chunk_id,
                    text=text,
                    score=float(getattr(point, "score", 0.0) or 0.0),
                )
            )

    if not candidates:
        return result

    if result.is_pto_question:
        candidates.sort(key=lambda hit: hit.score + _lexical_bonus(hit.text), reverse=True)
    else:
        candidates.sort(key=lambda hit: hit.score, reverse=True)

    # --- Fill the context window -----------------------------------------
    max_chunks = (
        config.PTO_CONTEXT_CHUNKS if result.is_pto_question else config.MAX_CONTEXT_CHUNKS
    )
    terms = _query_terms(question)

    blocks: list[str] = []
    total_chars = 0

    for hit in candidates:
        text = hit.text.strip()
        block = f"SOURCE: {hit.file}\nCHUNK: {hit.chunk}\n{text}\n"

        if total_chars + len(block) > config.MAX_CONTEXT_CHARS:
            continue

        hit.snippet = make_snippet(text, terms)
        result.hits.append(hit)
        blocks.append(block)
        total_chars += len(block)

        if len(result.hits) >= max_chunks:
            break

    result.context = "\n".join(blocks)
    return result
