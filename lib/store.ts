import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { extractText, isSupported } from "./extract";

export interface Chunk {
  id: string;
  /** Path relative to DOCS_DIR, e.g. "hr/handbook.pdf". */
  file: string;
  /** 0-based position of this chunk within its file. */
  index: number;
  text: string;
}

export interface IndexedFile {
  file: string;
  sizeBytes: number;
  modifiedAt: string;
  chunkCount: number;
  charCount: number;
}

export interface DocumentIndex {
  chunks: Chunk[];
  files: IndexedFile[];
  builtAt: string;
  docsDir: string;
  errors: string[];
}

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
]);

/**
 * Split text on paragraph boundaries into overlapping chunks, so a sentence
 * that straddles a boundary still appears whole in one of them.
 */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return text.trim() ? [text] : [];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const paragraph of paragraphs) {
    // A single oversized paragraph gets hard-split.
    if (paragraph.length > CHUNK_SIZE) {
      push();
      current = "";
      for (let i = 0; i < paragraph.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        const slice = paragraph.slice(i, i + CHUNK_SIZE).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > CHUNK_SIZE) {
      push();
      const tail = current.slice(-CHUNK_OVERLAP);
      current = `${tail}\n\n${paragraph}`;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  push();
  return chunks;
}

/** Recursively list every supported file under DOCS_DIR. */
async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(full, root, out);
    } else if (entry.isFile() && isSupported(full)) {
      out.push(full);
    }
  }
}

async function buildIndex(): Promise<DocumentIndex> {
  const root = config.docsDir;
  const errors: string[] = [];
  const chunks: Chunk[] = [];
  const files: IndexedFile[] = [];

  try {
    await fs.access(root);
  } catch {
    return {
      chunks: [],
      files: [],
      builtAt: new Date().toISOString(),
      docsDir: root,
      errors: [
        `Documents folder not found: ${root}. Create it, or point DOCS_DIR at an existing folder in .env.local.`,
      ],
    };
  }

  const filePaths: string[] = [];
  await walk(root, root, filePaths);
  filePaths.sort();

  for (const filePath of filePaths) {
    const relative = path.relative(root, filePath);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      errors.push(`Could not stat ${relative}`);
      continue;
    }

    if (stat.size > config.maxFileSizeBytes) {
      errors.push(`Skipped ${relative} (larger than MAX_FILE_SIZE_MB)`);
      continue;
    }

    const text = await extractText(filePath);
    if (!text) {
      errors.push(`No readable text in ${relative}`);
      continue;
    }

    const pieces = chunkText(text);
    pieces.forEach((piece, index) => {
      chunks.push({ id: `${relative}#${index}`, file: relative, index, text: piece });
    });

    files.push({
      file: relative,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      chunkCount: pieces.length,
      charCount: text.length,
    });
  }

  return {
    chunks,
    files,
    builtAt: new Date().toISOString(),
    docsDir: root,
    errors,
  };
}

// Cache the index in module scope so repeated questions don't re-parse every
// PDF. Next.js keeps this alive for the lifetime of the server process.
let cached: DocumentIndex | null = null;
let building: Promise<DocumentIndex> | null = null;

export async function getIndex(forceRebuild = false): Promise<DocumentIndex> {
  if (!forceRebuild && cached) return cached;
  if (building) return building;

  building = buildIndex()
    .then((index) => {
      cached = index;
      return index;
    })
    .finally(() => {
      building = null;
    });

  return building;
}

export function invalidateIndex(): void {
  cached = null;
}
