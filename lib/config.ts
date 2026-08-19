/**
 * Frontend settings, driven by .env.local.
 *
 * This app is a pure frontend: retrieval and generation both happen in the
 * maud-ai service (see backend/), which owns the embedding model, the Qdrant
 * collection and the vLLM connection. Everything here is about reaching it.
 */

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const maudHost = str("MAUD_HOST", "10.10.1.165");

export const config = {
  /** Base URL of the maud-ai FastAPI service. */
  maudApiUrl: str("MAUD_API_URL", `http://${maudHost}:8100`).replace(/\/+$/, ""),
  maudHost,

  /** Long, because a cold vLLM has to load the model before the first token. */
  chatTimeoutMs: num("MAUD_CHAT_TIMEOUT_MS", 300_000),
  /** Short, so a dead backend doesn't hang the status indicator. */
  statusTimeoutMs: num("MAUD_STATUS_TIMEOUT_MS", 10_000),
} as const;

export type AppConfig = typeof config;
