"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";

function FileIcon({ file }: { file: string }) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const color =
    ext === "pdf"
      ? "#E3163F"
      : ext === "docx"
        ? "#1436CD"
        : ext === "xlsx" || ext === "xls" || ext === "csv"
          ? "#188038"
          : "#5f6368";

  return (
    <span
      className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

export function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-5 border-t border-[#ebebeb] pt-4 dark:border-[#3c4043]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-[#5f6368] transition hover:text-[#202124] dark:text-[#9aa0a6] dark:hover:text-[#e3e3e3]"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          fill="currentColor"
        >
          <path d="M10 17l5-5-5-5v10z" />
        </svg>
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </button>

      {open && (
        <ol className="mt-3 space-y-2">
          {sources.map((source) => (
            <li
              key={source.n}
              id={`source-${source.n}`}
              className="scroll-mt-24 rounded-xl border border-[#ebebeb] bg-[#fafafa] p-3 dark:border-[#3c4043] dark:bg-[#1e1f20]"
            >
              <div className="flex items-start gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-[11px] font-medium text-brand-blue dark:bg-[#2d3748] dark:text-[#8ab4f8]">
                  {source.n}
                </span>
                <FileIcon file={source.file} />
                <span className="break-all text-sm font-medium">{source.file}</span>
              </div>
              <p className="mt-2 pl-7 text-[13px] leading-6 text-[#5f6368] dark:text-[#9aa0a6]">
                {source.snippet}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
