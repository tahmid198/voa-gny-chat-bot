"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentsResponse, HealthResponse } from "@/lib/types";

export function StatusBar() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on a click outside the panel, or on Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/documents", { method: "POST" });
      const data = (await response.json()) as DocumentsResponse;
      setHealth((prev) =>
        prev
          ? {
              ...prev,
              documents: {
                collection: data.collection,
                fileCount: data.fileCount,
                chunkCount: data.chunkCount,
                errors: data.errors,
              },
            }
          : prev,
      );
    } finally {
      setRefreshing(false);
    }
  };

  const llmOnline = health?.llm.online ?? false;
  const storeOnline = health?.vectorStore.online ?? false;
  const ready = llmOnline && health?.llm.modelAvailable && storeOnline;

  const dotColor = !health
    ? "bg-[#9aa0a6]"
    : ready
      ? "bg-[#188038]"
      : llmOnline || storeOnline
        ? "bg-[#f9ab00]"
        : "bg-brand-red";

  const statusLabel = !health
    ? "Checking…"
    : health.serviceError
      ? "Service offline"
      : ready
        ? "Ready"
        : !llmOnline
          ? "Model server offline"
          : !storeOnline
            ? "Vector store offline"
            : "Model not loaded";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
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
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Status</dt>
              <dd className="font-medium">{statusLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Model</dt>
              <dd className="truncate font-medium">{health?.llm.model ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Embeddings</dt>
              <dd className="truncate font-medium">
                {health?.vectorStore.embeddingModel ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#5f6368] dark:text-[#9aa0a6]">Collection</dt>
              <dd className="truncate font-medium">
                {health?.vectorStore.collection ?? "—"}
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

          {health?.serviceError && (
            <p className="mt-3 rounded-lg bg-[#fce8e6] p-2 text-[13px] leading-5 text-[#c5221f] dark:bg-[#3c1f1e] dark:text-[#f28b82]">
              {health.serviceError}
            </p>
          )}

          {health && !health.serviceError && !llmOnline && health.llm.error && (
            <p className="mt-3 rounded-lg bg-[#fce8e6] p-2 text-[13px] leading-5 text-[#c5221f] dark:bg-[#3c1f1e] dark:text-[#f28b82]">
              {health.llm.error}
            </p>
          )}

          {health && !health.serviceError && llmOnline && !health.llm.modelAvailable && (
            <p className="mt-3 rounded-lg bg-[#fef7e0] p-2 text-[13px] leading-5 text-[#b06000] dark:bg-[#3a2e10] dark:text-[#fdd663]">
              vLLM is serving{" "}
              <code className="font-mono">
                {health.llm.models.join(", ") || "no models"}
              </code>
              , not <code className="font-mono">{health.llm.model}</code>.
            </p>
          )}

          {health?.documents.errors.map((error) => (
            <p
              key={error}
              className="mt-3 rounded-lg bg-[#fef7e0] p-2 text-[13px] leading-5 text-[#b06000] dark:bg-[#3a2e10] dark:text-[#fdd663]"
            >
              {error}
            </p>
          ))}

          <p className="mt-3 break-all text-[12px] text-[#9aa0a6]">
            {health?.llm.host ?? "—"} · {health?.vectorStore.host ?? "—"}
            {health?.service?.version ? ` · v${health.service.version}` : ""}
          </p>

          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="mt-3 w-full rounded-full bg-[#f1f3f4] py-2 text-sm font-medium transition hover:bg-[#e8eaed] disabled:opacity-60 dark:bg-[#2d2e30] dark:hover:bg-[#3c4043]"
          >
            {refreshing ? "Refreshing…" : "Refresh document list"}
          </button>
        </div>
      )}
    </div>
  );
}
