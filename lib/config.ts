import path from "node:path";

/**
 * All tunable settings live here and are driven by .env.local so the Jetson's
 * IP address and the model name can be changed without touching code.
 */

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const jetsonIp = str("JETSON_IP", "192.168.3.153");

export const config = {
  /** Base URL for the Ollama HTTP API running on the Jetson Nano. */
  ollamaHost: str("OLLAMA_HOST", `http://${jetsonIp}:11434`).replace(/\/+$/, ""),
  /** Model name as it appears in `ollama list` on the Jetson. */
  ollamaModel: str("OLLAMA_MODEL", "llama3.2:3b"),
  ollamaTimeoutMs: num("OLLAMA_TIMEOUT_MS", 180_000),

  jetsonIp,
  jetsonSshUser: str("JETSON_SSH_USER", "admin"),

  /** Absolute path to the folder of documents the assistant can read. */
  docsDir: path.resolve(process.cwd(), str("DOCS_DIR", "./documents")),
  maxFileSizeBytes: num("MAX_FILE_SIZE_MB", 25) * 1024 * 1024,
  maxContextChunks: num("MAX_CONTEXT_CHUNKS", 8),
} as const;

export type AppConfig = typeof config;
