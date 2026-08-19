"""End-to-end checks over the NDJSON protocol the frontend consumes."""

from __future__ import annotations

import json
import re

import pytest
from conftest import FakeQdrantClient
from fastapi.testclient import TestClient

from maud_service import llm, pto, retrieval
from maud_service.main import app


def ndjson(body: str) -> list[dict]:
    return [json.loads(line) for line in body.splitlines() if line.strip()]


@pytest.fixture
def client(monkeypatch):
    async def fake_models():
        return ["google/gemma-3-1b-it"]

    monkeypatch.setattr(llm, "list_models", fake_models)

    with TestClient(app) as test_client:
        yield test_client


# --- Retrieval ------------------------------------------------------------


def test_build_queries_expands_pto_and_dedupes():
    queries = retrieval.build_queries("how much PTO do I get?")
    assert queries[0] == "how much PTO do I get?"
    assert len(queries) == len(set(q.lower() for q in queries))
    assert any("workdays" in q for q in queries)


def test_build_queries_leaves_unrelated_questions_alone():
    assert retrieval.build_queries("what is the dress code?") == [
        "what is the dress code?"
    ]


def test_followup_inherits_pto_intent():
    assert retrieval.is_pto_question("what about after 10 years?", "how much PTO?")
    assert not retrieval.is_pto_question("what about after 10 years?", "dress code?")


def test_lexical_bonus_lifts_the_table_above_higher_scoring_prose(pto_points):
    FakeQdrantClient.points = pto_points
    result = retrieval.search(
        FakeQdrantClient(), lambda text: [0.1, 0.2, 0.3], "how much PTO do I get?"
    )

    assert result.is_pto_question
    # The table scored 0.62 against the prose's 0.91 and still ranks first.
    assert result.hits[0].chunk == "44"
    assert "SOURCE: handbook.pdf" in result.context


def test_context_respects_the_char_budget(monkeypatch, pto_points):
    monkeypatch.setattr(retrieval.config, "MAX_CONTEXT_CHARS", 200)
    FakeQdrantClient.points = pto_points

    result = retrieval.search(
        FakeQdrantClient(), lambda text: [0.1], "how much PTO do I get?"
    )
    assert len(result.context) <= 200


# --- PTO extraction -------------------------------------------------------


def test_pto_tiers_parse_from_the_table(pto_points):
    tiers = pto.parse_tiers(pto_points[1].text)
    assert len(tiers) == 10
    assert (tiers[0].year, tiers[0].days, tiers[0].hours) == (1, 13, 104)
    assert (tiers[-1].year, tiers[-1].days, tiers[-1].hours) == (31, 34, 272)


def test_prose_does_not_parse_as_a_table(pto_points):
    assert pto.parse_tiers(pto_points[0].text) == []


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("how much PTO after 10 years?", "26 workdays (208 hours)"),
        ("PTO in my first year?", "13 workdays (104 hours)"),
        ("what is my PTO in the 3rd year", "19 workdays (152 hours)"),
        ("PTO after 30 years", "34 workdays (272 hours)"),
    ],
)
def test_pto_answer_picks_the_right_tier(pto_points, question, expected):
    answer = pto.answer(question, [
        retrieval.Hit(file="handbook.pdf", chunk="44", text=pto_points[1].text, score=1.0)
    ])
    assert expected in answer
    assert "[1]" in answer


def test_pto_answer_uses_correct_ordinals(pto_points):
    hits = [
        retrieval.Hit(file="handbook.pdf", chunk="44", text=pto_points[1].text, score=1.0)
    ]
    schedule = pto.answer("what is the PTO schedule?", hits)
    labels = re.findall(r"^- (\S+) year:", schedule, re.MULTILINE)

    assert labels == [
        "1st", "2nd", "3rd", "4th", "6th",
        "11th", "16th", "21st", "26th", "31st",
    ]


def test_pto_answer_returns_none_without_a_table(prose_points):
    hits = [
        retrieval.Hit(file="handbook.pdf", chunk="80", text=prose_points[0].text, score=1.0)
    ]
    assert pto.answer("how much PTO?", hits) is None


# --- HTTP ----------------------------------------------------------------


def test_health_reports_both_services(client, prose_points):
    FakeQdrantClient.points = prose_points
    body = client.get("/health").json()

    assert body["llm"]["online"] is True
    assert body["llm"]["modelAvailable"] is True
    assert body["vectorStore"]["collection"] == "hr-documents"
    assert body["documents"]["fileCount"] == 1


def test_health_survives_a_dead_vllm(client, monkeypatch, prose_points):
    async def boom():
        raise ConnectionError("connection refused")

    monkeypatch.setattr(llm, "list_models", boom)
    FakeQdrantClient.points = prose_points

    body = client.get("/health").json()
    assert body["llm"]["online"] is False
    assert "vLLM" in body["llm"]["error"]


def test_documents_lists_ingested_files(client, pto_points):
    FakeQdrantClient.points = pto_points
    body = client.post("/documents/refresh").json()

    assert body["fileCount"] == 1
    assert body["chunkCount"] == 2
    assert body["files"][0]["file"] == "handbook.pdf"


def test_chat_answers_pto_without_calling_the_model(client, monkeypatch, pto_points):
    FakeQdrantClient.points = pto_points

    async def must_not_run(messages):
        raise AssertionError("the LLM should be skipped for a parsed PTO table")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "stream_chat", must_not_run)

    events = ndjson(
        client.post("/chat", json={"question": "How much PTO after 10 years?"}).text
    )
    kinds = [event["type"] for event in events]

    assert kinds[0] == "sources"
    assert kinds[-1] == "done"
    assert events[0]["sources"][0]["n"] == 1
    answer = "".join(e["text"] for e in events if e["type"] == "delta")
    assert "26 workdays (208 hours)" in answer
    assert "11th year" in answer


def test_chat_streams_the_model_for_other_questions(client, monkeypatch, prose_points):
    FakeQdrantClient.points = prose_points
    captured: dict = {}

    async def fake_stream(messages):
        captured["messages"] = messages
        for piece in ("Bereavement leave is ", "up to three days [1]."):
            yield piece

    monkeypatch.setattr(llm, "stream_chat", fake_stream)

    events = ndjson(
        client.post(
            "/chat",
            json={
                "question": "What is the bereavement policy?",
                "history": [
                    {"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "hi"},
                ],
            },
        ).text
    )

    answer = "".join(e["text"] for e in events if e["type"] == "delta")
    assert answer == "Bereavement leave is up to three days [1]."
    assert events[-1]["type"] == "done"

    # History is forwarded, and the context block is numbered for citations.
    roles = [m["role"] for m in captured["messages"]]
    assert roles == ["system", "user", "assistant", "user"]
    assert "[1] SOURCE: handbook.pdf" in captured["messages"][-1]["content"]


def test_chat_reports_no_results(client, monkeypatch):
    FakeQdrantClient.points = []

    async def unused(messages):
        raise AssertionError("no context means no model call")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "stream_chat", unused)

    events = ndjson(client.post("/chat", json={"question": "who won the game?"}).text)
    answer = "".join(e["text"] for e in events if e["type"] == "delta")

    assert events[0]["sources"] == []
    assert "unavailable in the supplied HR documents" in answer


def test_chat_surfaces_model_failures_as_stream_errors(client, monkeypatch, prose_points):
    FakeQdrantClient.points = prose_points

    async def boom(messages):
        raise ConnectionError("connection refused")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "stream_chat", boom)

    events = ndjson(client.post("/chat", json={"question": "bereavement?"}).text)
    errors = [e for e in events if e["type"] == "error"]

    assert len(errors) == 1
    assert "vLLM" in errors[0]["message"]


def test_chat_rejects_an_empty_question(client):
    events = ndjson(client.post("/chat", json={"question": "   "}).text)
    assert events == [{"type": "error", "message": "A question is required."}]


# --- Context window budget ------------------------------------------------


def test_history_is_trimmed_to_the_configured_turns():
    history = [
        {"role": "user", "content": f"q{n}"} if n % 2 == 0 else
        {"role": "assistant", "content": f"a{n}"}
        for n in range(10)
    ]
    hits = [retrieval.Hit(file="f.pdf", chunk="1", text="body", score=1.0)]

    messages = llm.build_messages("now what?", hits, history)
    carried = [m["content"] for m in messages[1:-1]]

    # system + (2 turns = 4 messages) + the question
    assert len(messages) == 6
    assert carried == ["q6", "a7", "q8", "a9"]


def test_long_prior_answers_are_truncated_not_dropped():
    history = [
        {"role": "user", "content": "explain the leave policy"},
        {"role": "assistant", "content": "x" * 5000},
    ]
    hits = [retrieval.Hit(file="f.pdf", chunk="1", text="body", score=1.0)]

    messages = llm.build_messages("and for part-timers?", hits, history)
    prior_answer = messages[2]["content"]

    assert len(prior_answer) <= llm.config.MAX_HISTORY_CHARS + 2
    assert prior_answer.endswith("…")


def test_worst_case_prompt_fits_a_2048_token_window():
    """vLLM is serving --max-model-len 2048; the prompt plus the reserved
    answer has to fit inside it."""
    hits = [
        retrieval.Hit(file="handbook.pdf", chunk=str(n), text="y" * 4000, score=1.0)
        for n in range(5)
    ]
    history = [
        {"role": "user", "content": "z" * 5000},
        {"role": "assistant", "content": "z" * 5000},
    ] * 5

    messages = llm.build_messages("q" * 300, hits, history)
    chars = sum(len(m["content"]) for m in messages)

    # 3 chars/token is pessimistic for English; numeric tables tokenize worst.
    estimated_prompt_tokens = chars / 3
    assert estimated_prompt_tokens + llm.config.MAX_OUTPUT_TOKENS < 2048, (
        f"{chars} prompt chars (~{estimated_prompt_tokens:.0f} tokens) plus "
        f"{llm.config.MAX_OUTPUT_TOKENS} output tokens overflows the window"
    )


def test_context_overflow_gets_an_actionable_message():
    error = RuntimeError(
        "vLLM responded 400: This model's maximum context length is 2048 tokens"
    )
    message = llm.describe_error(error)

    assert "MAX_CONTEXT_CHARS" in message and "max-model-len" in message
