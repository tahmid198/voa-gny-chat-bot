import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import { getIndex } from "@/lib/store";
import { search } from "@/lib/search";
import { describeOllamaError, streamChat, type ChatMessage } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatRequestBody {
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

const SYSTEM_PROMPT = `You are the VOA-GNY document assistant. You answer questions using only the excerpts from company documents provided in the CONTEXT block.

Rules:
- Base every factual claim on the context. Do not use outside knowledge.
- Cite the sources you used with bracketed numbers matching the context, like [1] or [2][3].
- If the context does not contain the answer, say so plainly and suggest what document might have it. Never invent details.
- Be concise and direct. Use short paragraphs or bullets. Lead with the answer.`;

function buildContext(
  hits: { chunk: { file: string; index: number; text: string } }[],
): string {
  return hits
    .map((hit, i) => `[${i + 1}] Source: ${hit.chunk.file}\n${hit.chunk.text}`)
    .join("\n\n---\n\n");
}

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const index = await getIndex();

        if (index.chunks.length === 0) {
          send({
            type: "error",
            message:
              index.errors[0] ??
              `No readable documents found in ${index.docsDir}. Add files there and try again.`,
          });
          controller.close();
          return;
        }

        const hits = search(index, question, config.maxContextChunks);

        if (hits.length === 0) {
          send({ type: "sources", sources: [] });
          send({
            type: "delta",
            text: `I couldn't find anything matching that in the ${index.files.length} indexed document${
              index.files.length === 1 ? "" : "s"
            }. Try different wording, or check that the relevant file is in the documents folder.`,
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        send({
          type: "sources",
          sources: hits.map((hit, i) => ({
            n: i + 1,
            file: hit.chunk.file,
            snippet: hit.snippet,
            score: Number(hit.score.toFixed(3)),
          })),
        });

        const history = (body.history ?? []).slice(-6);
        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
          {
            role: "user",
            content: `CONTEXT:\n${buildContext(hits)}\n\nQUESTION: ${question}`,
          },
        ];

        for await (const delta of streamChat(messages, request.signal)) {
          send({ type: "delta", text: delta });
        }

        send({ type: "done" });
      } catch (error) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        send({ type: "error", message: describeOllamaError(error) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
