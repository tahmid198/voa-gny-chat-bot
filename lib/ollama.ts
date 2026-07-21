import { config } from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Ask the Jetson which models it has pulled. Doubles as a health check. */
export async function listModels(): Promise<string[]> {
  const response = await fetch(`${config.ollamaHost}/api/tags`, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Ollama responded ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

/**
 * Stream a chat completion from Ollama, yielding text deltas as they arrive.
 * Ollama emits newline-delimited JSON, one object per token batch.
 */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      stream: true,
      options: { temperature: 0.2 },
    }),
    signal: signal ?? AbortSignal.timeout(config.ollamaTimeoutMs),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${response.status}). ${detail.slice(0, 300)}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as {
          message?: { content?: string };
          error?: string;
          done?: boolean;
        };
        if (parsed.error) throw new Error(parsed.error);
        const content = parsed.message?.content;
        if (content) yield content;
      } catch (error) {
        if (error instanceof SyntaxError) continue; // partial line, skip
        throw error;
      }
    }
  }
}

/** Turn a connection failure into something a human can act on. */
export function describeOllamaError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out|timeout|abort/i.test(message)) {
    return `The Jetson at ${config.jetsonIp} didn't respond in time. It may still be loading "${config.ollamaModel}" into memory — try again in a moment.`;
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) {
    return `Can't reach Ollama at ${config.ollamaHost}. Check the Jetson is powered on, that Ollama is running, and that it's bound to 0.0.0.0 rather than localhost.`;
  }
  if (/not found|no such model/i.test(message)) {
    return `The model "${config.ollamaModel}" isn't on the Jetson yet. SSH in and run: ollama pull ${config.ollamaModel}`;
  }
  return message;
}
