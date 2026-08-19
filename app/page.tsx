"use client";

import { useCallback, useRef, useState } from "react";
import { Answer } from "@/components/Answer";
import { Logo } from "@/components/Logo";
import { SearchBar } from "@/components/SearchBar";
import { Sources } from "@/components/Sources";
import { StatusBar } from "@/components/StatusBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { ChatStreamEvent, Turn } from "@/lib/types";

const EXAMPLES = [
  "How much PTO do I get after 10 years?",
  "What is the policy on bereavement leave?",
  "Which documents mention safety training?",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      const id = `${Date.now()}`;
      setQuery("");
      setBusy(true);
      setTurns((prev) => [
        ...prev,
        { id, question: trimmed, answer: "", sources: [], streaming: true },
      ]);

      const patch = (changes: Partial<Turn>) =>
        setTurns((prev) =>
          prev.map((turn) => (turn.id === id ? { ...turn, ...changes } : turn)),
        );

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            question: trimmed,
            // Give the model a little conversational memory.
            history: turns.flatMap((turn) =>
              turn.error
                ? []
                : [
                    { role: "user" as const, content: turn.question },
                    { role: "assistant" as const, content: turn.answer },
                  ],
            ),
          }),
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(detail?.error ?? `Request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            let event: ChatStreamEvent;
            try {
              event = JSON.parse(line) as ChatStreamEvent;
            } catch {
              continue;
            }

            if (event.type === "sources") {
              patch({ sources: event.sources });
            } else if (event.type === "delta") {
              answer += event.text;
              patch({ answer });
            } else if (event.type === "error") {
              patch({ error: event.message, streaming: false });
            }
          }

          bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        }

        patch({ streaming: false });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          patch({ error: (error as Error).message, streaming: false });
        } else {
          patch({ streaming: false });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, turns],
  );

  const stop = () => abortRef.current?.abort();
  const started = turns.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className={`sticky top-0 z-10 flex items-center gap-3 px-4 py-3 sm:px-6 ${
          started
            ? "border-b border-[#ebebeb] bg-white/90 backdrop-blur dark:border-[#3c4043] dark:bg-[#131314]/90"
            : "justify-end"
        }`}
      >
        {started && (
          <>
            <button
              type="button"
              onClick={() => {
                stop();
                setTurns([]);
                setQuery("");
              }}
              className="shrink-0"
              aria-label="New search"
            >
              <Logo className="h-7 w-auto" />
            </button>
            <div className="mx-auto w-full max-w-2xl">
              <SearchBar
                value={query}
                onChange={setQuery}
                onSubmit={() => void ask(query)}
                onStop={stop}
                busy={busy}
                compact
                placeholder="Ask a follow-up"
              />
            </div>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <StatusBar />
          <ThemeToggle />
        </div>
      </header>

      {!started ? (
        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-32">
          <Logo className="mb-8 h-14 w-auto sm:h-16" />
          <div className="w-full max-w-xl">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={() => void ask(query)}
              autoFocus
            />
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void ask(example)}
                className="rounded-full border border-[#dfe1e5] px-4 py-2 text-[13px] text-[#5f6368] transition hover:border-transparent hover:shadow-search dark:border-[#3c4043] dark:text-[#9aa0a6] dark:hover:bg-[#2d2e30]"
              >
                {example}
              </button>
            ))}
          </div>

          <p className="mt-10 text-[13px] text-[#9aa0a6]">
            Answers come from VOA-GNY documents, retrieved and generated on-premise.
          </p>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
          {turns.map((turn) => (
            <article
              key={turn.id}
              className="mb-10 border-b border-[#f1f3f4] pb-8 last:border-0 dark:border-[#2d2e30]"
            >
              <h2 className="mb-3 text-xl font-normal text-[#202124] dark:text-[#e3e3e3]">
                {turn.question}
              </h2>

              {turn.error ? (
                <div className="rounded-xl bg-[#fce8e6] p-4 text-sm leading-6 text-[#c5221f] dark:bg-[#3c1f1e] dark:text-[#f28b82]">
                  {turn.error}
                </div>
              ) : turn.answer === "" && turn.streaming ? (
                <div className="flex items-center gap-2 py-2 text-sm text-[#5f6368] dark:text-[#9aa0a6]">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-blue border-t-transparent" />
                  Searching your documents…
                </div>
              ) : (
                <Answer
                  text={turn.answer}
                  sources={turn.sources}
                  streaming={turn.streaming}
                />
              )}

              {!turn.error && <Sources sources={turn.sources} />}
            </article>
          ))}
          <div ref={bottomRef} />
        </main>
      )}
    </div>
  );
}
