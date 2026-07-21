"use client";

import { Fragment, type ReactNode } from "react";
import type { Source } from "@/lib/types";

/**
 * Minimal markdown renderer — enough for what a small local model emits
 * (bullets, bold, inline code, headings) plus clickable [n] citations.
 * Avoids pulling a full markdown dependency into the bundle.
 */

function renderInline(text: string, sources: Source[], key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  const parts = text.split(pattern);

  parts.forEach((part, i) => {
    if (!part) return;
    const id = `${key}-${i}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={id} className="font-semibold">
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code
          key={id}
          className="rounded bg-[#f1f3f4] px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-[#2d2e30]"
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }

    const citation = /^\[(\d+)\]$/.exec(part);
    if (citation) {
      const n = Number(citation[1]);
      const source = sources.find((s) => s.n === n);
      nodes.push(
        <a
          key={id}
          href={`#source-${n}`}
          title={source?.file ?? `Source ${n}`}
          className="mx-0.5 inline-flex h-[1.15em] min-w-[1.15em] items-center justify-center rounded-full bg-[#e8f0fe] px-1 align-super text-[0.7em] font-medium text-brand-blue no-underline transition hover:bg-[#d2e3fc] dark:bg-[#2d3748] dark:text-[#8ab4f8] dark:hover:bg-[#3c4a5e]"
        >
          {n}
        </a>,
      );
      return;
    }

    nodes.push(<Fragment key={id}>{part}</Fragment>);
  });

  return nodes;
}

export function Answer({
  text,
  sources,
  streaming,
}: {
  text: string;
  sources: Source[];
  streaming: boolean;
}) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, sources, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    if (numbered) {
      bullets.push(numbered[1]);
      return;
    }

    flushBullets();

    if (!line.trim()) return;

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h-${i}`} className="mt-3 font-semibold">
          {renderInline(heading[2], sources, `h-${i}`)}
        </p>,
      );
      return;
    }

    blocks.push(
      <p key={`p-${i}`} className="my-2 leading-7">
        {renderInline(line, sources, `p-${i}`)}
      </p>,
    );
  });

  flushBullets();

  return (
    <div className={`text-[15px] ${streaming ? "caret" : ""}`}>
      {blocks.length > 0 ? blocks : null}
    </div>
  );
}
