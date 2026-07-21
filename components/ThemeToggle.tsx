"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("voa-theme", next ? "dark" : "light");
    } catch {
      /* private browsing */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid h-10 w-10 place-items-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] dark:text-[#9aa0a6] dark:hover:bg-[#2d2e30]"
    >
      {/* Render nothing until mounted so SSR and client markup agree. */}
      {mounted &&
        (dark ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5a1 1 0 011 1v2a1 1 0 11-2 0V3a1 1 0 011-1zm0 17a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zM2 12a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm17 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zM4.9 4.9a1 1 0 011.4 0l1.4 1.4a1 1 0 11-1.4 1.4L4.9 6.3a1 1 0 010-1.4zm11.4 11.4a1 1 0 011.4 0l1.4 1.4a1 1 0 01-1.4 1.4l-1.4-1.4a1 1 0 010-1.4zm2.8-11.4a1 1 0 010 1.4l-1.4 1.4a1 1 0 11-1.4-1.4l1.4-1.4a1 1 0 011.4 0zM7.7 16.3a1 1 0 010 1.4l-1.4 1.4a1 1 0 01-1.4-1.4l1.4-1.4a1 1 0 011.4 0z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M21.5 14.1A9 9 0 019.9 2.5a1 1 0 00-1.3-1.2A11 11 0 1022.7 15.4a1 1 0 00-1.2-1.3z" />
          </svg>
        ))}
    </button>
  );
}
