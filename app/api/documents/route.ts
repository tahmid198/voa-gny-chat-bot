import { describeMaudError, getJson, postJson } from "@/lib/maud";
import type { DocumentsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown): DocumentsResponse {
  return {
    collection: "—",
    builtAt: new Date().toISOString(),
    fileCount: 0,
    chunkCount: 0,
    files: [],
    errors: [describeMaudError(error)],
  };
}

/** Everything currently ingested into the Qdrant collection. */
export async function GET() {
  try {
    return Response.json(await getJson<DocumentsResponse>("/documents"));
  } catch (error) {
    return Response.json(failure(error));
  }
}

/**
 * Re-read the collection. This does not re-ingest — ingestion is a separate
 * step on the maud-ai host (`python ingest_documents.py`); this just refreshes
 * the cached inventory after documents have been added there.
 */
export async function POST() {
  try {
    return Response.json(
      await postJson<DocumentsResponse>("/documents/refresh", {}, 60_000),
    );
  } catch (error) {
    return Response.json(failure(error));
  }
}
