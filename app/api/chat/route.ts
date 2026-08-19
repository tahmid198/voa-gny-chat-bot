import { NextRequest } from "next/server";
import { describeMaudError, openChatStream } from "@/lib/maud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatRequestBody {
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

/**
 * Proxies the browser to the maud-ai service. Retrieval, the PTO table
 * extraction and generation all happen there; this route only validates the
 * question and forwards the newline-delimited JSON stream back.
 */
export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }

  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await openChatStream(
      { question, history: body.history ?? [] },
      request.signal,
    );
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    // Report the failure inside the stream protocol so the UI renders it in
    // place of the answer rather than as a bare fetch error.
    const message = describeMaudError(error);
    const line = `${JSON.stringify({ type: "error", message })}\n`;

    return new Response(line, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  }

  return new Response(upstream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
