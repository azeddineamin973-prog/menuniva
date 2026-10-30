'use client';

import { useEffect, useState } from 'react';

/** Light/dark mode for the MenuNiva dashboard, persisted in a cookie so the server renders it without flashing. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  return (
    <button
      type="button"
      className="w-full rounded-xl px-3 py-2 text-start text-sm text-ink/80 hover:bg-surface-2"
      onClick={() => {
        const next = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', next);
        document.cookie = `mn_theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
        setDark(next);
      }}
    >
      {dark ? '☀︎ Light mode' : '☾ Dark mode'}
    </button>
  );
}
