import { config } from "./config";

/**
 * Thin client for the maud-ai service. All calls run server-side from the
 * Next.js API routes, so the backend never has to be exposed to browsers.
 */

export class MaudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaudError";
  }
}

async function request(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = config.statusTimeoutMs, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${config.maudApiUrl}${path}`, {
      ...rest,
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new MaudError(describeMaudError(error));
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MaudError(
      `The maud-ai service responded ${response.status}. ${detail.slice(0, 300)}`.trim(),
    );
  }

  return response;
}

/** GET a JSON endpoint on the backend. */
export async function getJson<T>(path: string, timeoutMs?: number): Promise<T> {
  const response = await request(path, { timeoutMs });
  return (await response.json()) as T;
}

/** POST a JSON endpoint on the backend. */
export async function postJson<T>(
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    timeoutMs,
  });
  return (await response.json()) as T;
}

/**
 * Open the chat stream. The backend already speaks the newline-delimited JSON
 * protocol the browser expects, so the route can pipe this body straight
 * through without re-encoding it.
 */
export async function openChatStream(
  body: unknown,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    timeoutMs: config.chatTimeoutMs,
  });

  if (!response.body) {
    throw new MaudError("The maud-ai service returned an empty response.");
  }

  return response.body;
}

/** Turn a connection failure into something a human can act on. */
export function describeMaudError(error: unknown): string {
  if (error instanceof MaudError) return error.message;

  const message = error instanceof Error ? error.message : String(error);

  if (/timed out|timeout|abort/i.test(message)) {
    return `The maud-ai service at ${config.maudApiUrl} didn't respond in time. vLLM may still be loading the model — try again in a moment.`;
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) {
    return `Can't reach the maud-ai service at ${config.maudApiUrl}. Check that the host is up and that the service is running: ssh ${config.maudHost} then systemctl status maud-ai`;
  }
  return message;
}
