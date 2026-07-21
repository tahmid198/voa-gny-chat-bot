import { NextRequest } from "next/server";
import { getIndex, invalidateIndex } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List everything currently indexed. */
export async function GET() {
  const index = await getIndex();

  return Response.json({
    docsDir: index.docsDir,
    builtAt: index.builtAt,
    fileCount: index.files.length,
    chunkCount: index.chunks.length,
    files: index.files,
    errors: index.errors,
  });
}

/** Re-scan the folder after files have been added or changed. */
export async function POST(_request: NextRequest) {
  invalidateIndex();
  const index = await getIndex(true);

  return Response.json({
    docsDir: index.docsDir,
    builtAt: index.builtAt,
    fileCount: index.files.length,
    chunkCount: index.chunks.length,
    files: index.files,
    errors: index.errors,
  });
}
