"use client";

import { useEffect, useRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  compact?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  autoFocus = false,
  placeholder = "Ask anything about your documents",
  compact = false,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // "/" focuses the box from anywhere, as long as you're not already typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      className="w-full"
    >
      <div
        className={`group flex w-full items-center gap-3 rounded-full border border-[#dfe1e5] bg-white transition hover:border-transparent hover:shadow-search focus-within:border-transparent focus-within:shadow-search dark:border-[#5f6368] dark:bg-[#1e1f20] dark:hover:border-transparent dark:hover:bg-[#2d2e30] dark:focus-within:bg-[#2d2e30] ${
          compact ? "h-11 px-4" : "h-12 px-5"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-[#9aa0a6]"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#9aa0a6] dark:text-[#e3e3e3]"
        />

        {value && !busy && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#70757a] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}

        {busy && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-full px-3 py-1 text-sm font-medium text-brand-blue hover:bg-[#f1f3f4] dark:text-[#8ab4f8] dark:hover:bg-[#3c4043]"
          >
            Stop
          </button>
        )}
      </div>
    </form>
  );
}
