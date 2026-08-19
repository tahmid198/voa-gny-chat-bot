"""Talking to vLLM's OpenAI-compatible endpoint."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from . import config

SYSTEM_PROMPT = """You are the VOA-Greater New York HR assistant.

Answer ONLY from the HR document excerpts in the CONTEXT block.

Rules:
- Base every factual claim on the context. Do not use outside knowledge.
- Cite the excerpts you used with bracketed numbers, like [1] or [2][3].
- If the context does not contain the answer, say exactly: The information is \
unavailable in the supplied HR documents.
- Be concise and direct. Lead with the answer. Use short paragraphs or bullets."""


def build_context(hits) -> str:
    """Number the chunks so the model's [n] citations line up with the UI.

    Retrieval already keeps the selected chunks inside MAX_CONTEXT_CHARS, but
    the cap is re-applied here so the prompt cannot overflow the model window
    if it is ever called with an unbounded set of hits.
    """
    blocks: list[str] = []
    remaining = config.MAX_CONTEXT_CHARS

    for position, hit in enumerate(hits, start=1):
        header = f"[{position}] SOURCE: {hit.file} (chunk {hit.chunk})\n"
        if len(header) >= remaining:
            break

        text = hit.text[: remaining - len(header)]
        blocks.append(header + text)
        remaining -= len(header) + len(text)

        if remaining <= 0:
            break

    return "\n\n---\n\n".join(blocks)


def build_messages(question: str, hits, history: list[dict]) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Keep the last few turns so follow-ups read naturally, but not so many
    # that they crowd out the context block. Long prior answers are truncated
    # rather than dropped, so the thread still reads as a conversation.
    for turn in history[-(config.MAX_HISTORY_TURNS * 2) :]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        if len(content) > config.MAX_HISTORY_CHARS:
            content = content[: config.MAX_HISTORY_CHARS].rstrip() + " …"
        messages.append({"role": role, "content": content})

    messages.append(
        {
            "role": "user",
            "content": f"CONTEXT:\n{build_context(hits)}\n\nQUESTION: {question}",
        }
    )
    return messages


async def stream_chat(messages: list[dict]) -> AsyncIterator[str]:
    """Yield content deltas from vLLM as they arrive."""
    payload = {
        "model": config.MODEL_NAME,
        "messages": messages,
        "temperature": 0,
        "max_tokens": config.MAX_OUTPUT_TOKENS,
        "stream": True,
    }

    timeout = httpx.Timeout(config.LLM_TIMEOUT_SECONDS, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", f"{config.VLLM_BASE_URL}/chat/completions", json=payload
        ) as response:
            if response.status_code != 200:
                detail = (await response.aread()).decode("utf-8", "replace")
                raise RuntimeError(
                    f"vLLM responded {response.status_code}: {detail[:300]}"
                )

            async for line in response.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue

                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    return

                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError:
                    continue

                for choice in parsed.get("choices", []):
                    content = (choice.get("delta") or {}).get("content")
                    if content:
                        yield content


async def list_models() -> list[str]:
    """Model ids vLLM is currently serving. Doubles as a health check."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
        response = await client.get(f"{config.VLLM_BASE_URL}/models")
        response.raise_for_status()
        data = response.json()

    return [entry.get("id", "") for entry in data.get("data", []) if entry.get("id")]


def describe_error(error: Exception) -> str:
    """Turn a connection failure into something an admin can act on."""
    message = str(error)

    if isinstance(error, httpx.TimeoutException) or "timeout" in message.lower():
        return (
            f'The model server did not respond in time. It may still be loading '
            f'"{config.MODEL_NAME}" — try again in a moment.'
        )
    if isinstance(error, httpx.ConnectError) or "connection" in message.lower():
        return (
            f"Can't reach vLLM at {config.VLLM_BASE_URL}. Check that the vLLM "
            f"service is running on the maud-ai host."
        )
    if "maximum context length" in message.lower() or "context length" in message.lower():
        return (
            "The question plus its context exceeded the model's window. Lower "
            "MAX_CONTEXT_CHARS / MAX_OUTPUT_TOKENS for the maud-ai service, or "
            "restart vLLM with a larger --max-model-len."
        )
    if "not found" in message.lower() or "does not exist" in message.lower():
        return (
            f'vLLM is not serving "{config.MODEL_NAME}". Check the --model flag '
            f"it was started with."
        )
    return message
