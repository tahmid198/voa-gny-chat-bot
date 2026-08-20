/** Shared between the API routes and the client components. */

export interface Source {
  n: number;
  file: string;
  /** Path relative to the ingestion root, e.g. "OneDrive_2026-08-04/policy.pdf". */
  path?: string;
  /** Chunk id within the source document, as stored in Qdrant. */
  chunk?: string;
  snippet: string;
  score: number;
}

export interface Turn {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  error?: string;
  streaming: boolean;
}

export interface IndexedFileInfo {
  file: string;
  path?: string;
  chunkCount: number;
  charCount: number;
}

export interface DocumentsResponse {
  collection: string;
  builtAt: string;
  fileCount: number;
  chunkCount: number;
  files: IndexedFileInfo[];
  errors: string[];
}

export interface HealthResponse {
  /** Version of the maud-ai service answering this call. */
  service?: { version: string };
  /** vLLM, serving the generation model. */
  llm: {
    online: boolean;
    models: string[];
    modelAvailable: boolean;
    error?: string;
    host: string;
    model: string;
  };
  /** Qdrant, holding the embedded document chunks. */
  vectorStore: {
    host: string;
    collection: string;
    online: boolean;
    embeddingModel: string;
  };
  documents: {
    collection: string;
    fileCount: number;
    chunkCount: number;
    errors: string[];
  };
  /** Set by the frontend when the maud-ai service itself is unreachable. */
  serviceError?: string;
}

/** Line protocol emitted by /api/chat (newline-delimited JSON). */
export type ChatStreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
