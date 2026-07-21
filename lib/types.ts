/** Shared between the API routes and the client components. */

export interface Source {
  n: number;
  file: string;
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
  sizeBytes: number;
  modifiedAt: string;
  chunkCount: number;
  charCount: number;
}

export interface DocumentsResponse {
  docsDir: string;
  builtAt: string;
  fileCount: number;
  chunkCount: number;
  files: IndexedFileInfo[];
  errors: string[];
}

export interface HealthResponse {
  jetson: {
    online: boolean;
    models: string[];
    modelAvailable: boolean;
    error?: string;
    host: string;
    model: string;
  };
  documents: {
    docsDir: string;
    fileCount: number;
    chunkCount: number;
    errors: string[];
  };
}

/** Line protocol emitted by /api/chat (newline-delimited JSON). */
export type ChatStreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
