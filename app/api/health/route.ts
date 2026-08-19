import { config } from "@/lib/config";
import { describeMaudError, getJson } from "@/lib/maud";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether vLLM, Qdrant and the maud-ai service itself are healthy. */
export async function GET() {
  try {
    return Response.json(await getJson<HealthResponse>("/health"));
  } catch (error) {
    const message = describeMaudError(error);

    // Shape-compatible fallback so the status panel still renders.
    const offline: HealthResponse = {
      llm: {
        online: false,
        models: [],
        modelAvailable: false,
        error: message,
        host: "—",
        model: "—",
      },
      vectorStore: {
        host: "—",
        collection: "—",
        online: false,
        embeddingModel: "—",
      },
      documents: { collection: "—", fileCount: 0, chunkCount: 0, errors: [] },
      serviceError: `${config.maudApiUrl} — ${message}`,
    };

    return Response.json(offline);
  }
}
