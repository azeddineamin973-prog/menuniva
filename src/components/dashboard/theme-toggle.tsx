'use client';

import { useEffect, useState } from 'react';

/**
 * Light/dark mode for the MenuNiva dashboard, persisted in a cookie so the server renders it
 * without flashing. Shown as a compact icon button in the sidebar footer.
 */
export function ThemeToggle({ labels = { dark: 'Dark mode', light: 'Light mode' } }: { labels?: { dark: string; light: string } }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const label = dark ? labels.light : labels.dark;
  return (
    <button
      type="button"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:size-10"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', next);
        document.cookie = `mn_theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
        setDark(next);
      }}
      data-testid="theme-toggle"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
