"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentsResponse, HealthResponse } from "@/lib/types";

export function StatusBar() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setHealth((await response.json()) as HealthResponse);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const reindex = async () => {
    setReindexing(true);
    try {
      const response = await fetch("/api/documents", { method: "POST" });
      const data = (await response.json()) as DocumentsResponse;
      setHealth((prev) =>
        prev
          ? {
              ...prev,
              documents: {
                docsDir: data.docsDir,
                fileCount: data.fileCount,
                chunkCount: data.chunkCount,
                errors: data.errors,
              },
            }
          : prev,
      );
    } finally {
      setReindexing(false);
    }
  };

  const online = health?.jetson.online ?? false;
  const dotColor = !health
    ? "bg-[#9aa0a6]"
    : online && health.jetson.modelAvailable
      ? "bg-[#188038]"
      : online
        ? "bg-[#f9ab00]"
        : "bg-brand-red";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-[#5f6368] transition hover:bg-[#f1f3f4] dark:text-[#9aa0a6] dark:hover:bg-[#2d2e30]"
      >
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="hidden sm:inline">
          {health?.documents.fileCount ?? 0} doc
          {health?.documents.fileCount === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-[#ebebeb] bg-white p-4 text-sm shadow-lg dark:border-[#3c4043] dark:bg-[#1e1f20]">
          <dl className="space-y-2">
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Jetson</dt>
              <dd className="truncate font-medium">
                {health?.jetson.host ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Model</dt>
              <dd className="truncate font-medium">{health?.jetson.model ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Status</dt>
              <dd className="font-medium">
                {!health
                  ? "Checking…"
                  : online && health.jetson.modelAvailable
                    ? "Ready"
                    : online
                      ? "Model not pulled"
                      : "Offline"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Indexed</dt>
              <dd className="font-medium">
                {health?.documents.fileCount ?? 0} files ·{" "}
                {health?.documents.chunkCount ?? 0} chunks
              </dd>
            </div>
          </dl>

          {health && !online && health.jetson.error && (
            <p className="mt-3 rounded-lg bg-[#fce8e6] p-2 text-[13px] leading-5 text-[#c5221f] dark:bg-[#3c1f1e] dark:text-[#f28b82]">
              {health.jetson.error}
            </p>
          )}

          {health && online && !health.jetson.modelAvailable && (
            <p className="mt-3 rounded-lg bg-[#fef7e0] p-2 text-[13px] leading-5 text-[#b06000] dark:bg-[#3a2e10] dark:text-[#fdd663]">
              Run{" "}
              <code className="font-mono">ollama pull {health.jetson.model}</code> on
              the Jetson.
            </p>
          )}

          <p className="mt-3 break-all text-[12px] text-[#9aa0a6]">
            {health?.documents.docsDir}
          </p>

          <button
            type="button"
            onClick={reindex}
            disabled={reindexing}
            className="mt-3 w-full rounded-full bg-[#f1f3f4] py-2 text-sm font-medium transition hover:bg-[#e8eaed] disabled:opacity-60 dark:bg-[#2d2e30] dark:hover:bg-[#3c4043]"
          >
            {reindexing ? "Re-indexing…" : "Re-index documents"}
          </button>
        </div>
      )}
    </div>
  );
}
