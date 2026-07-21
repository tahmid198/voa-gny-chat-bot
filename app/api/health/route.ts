import { config } from "@/lib/config";
import { describeOllamaError, listModels } from "@/lib/ollama";
import { getIndex } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether the Jetson is reachable and whether documents are indexed. */
export async function GET() {
  const index = await getIndex();

  let jetson: {
    online: boolean;
    models: string[];
    modelAvailable: boolean;
    error?: string;
  };

  try {
    const models = await listModels();
    jetson = {
      online: true,
      models,
      // Ollama reports "llama3.2:3b"; tolerate the user omitting the tag.
      modelAvailable: models.some(
        (m) => m === config.ollamaModel || m.split(":")[0] === config.ollamaModel,
      ),
    };
  } catch (error) {
    jetson = {
      online: false,
      models: [],
      modelAvailable: false,
      error: describeOllamaError(error),
    };
  }

  return Response.json({
    jetson: { ...jetson, host: config.ollamaHost, model: config.ollamaModel },
    documents: {
      docsDir: index.docsDir,
      fileCount: index.files.length,
      chunkCount: index.chunks.length,
      errors: index.errors,
    },
  });
}
