'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Near-real-time updates by polling (clearly labelled in the UI; MenuNiva MVP does not use
 * WebSockets). Reloads authoritative state immediately on reconnect or when the tab
 * becomes visible again, and reports connection health.
 */
export function usePolling<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [online, setOnline] = useState(true);
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const [authError, setAuthError] = useState(false);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403 || r.status === 404) {
        setAuthError(true);
      } else if (r.ok) {
        setData(await r.json());
        setOnline(true);
        setLastOk(new Date());
      } else setOnline(false);
    } catch {
      setOnline(false);
    } finally {
      inflight.current = false;
    }
  }, [url]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    const onOnline = () => refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, online, lastOk, authError, refresh };
}

export function ConnectionBadge({ online, lastOk, intervalMs, labels }: { online: boolean; lastOk: Date | null; intervalMs: number; labels?: { live: string; lost: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${online ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}
      role="status"
      data-testid="connection-status"
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'animate-pulse bg-danger'}`} />
      {online ? (labels?.live ?? 'Live · refreshes every {s} s').replace('{s}', String(Math.round(intervalMs / 1000))) : (labels?.lost ?? 'Connection lost — retrying. Orders are safe on the server.')}
      {lastOk && <span className="opacity-70">· {lastOk.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
    </span>
  );
}

/** Short two-tone chime generated with WebAudio (no audio file needed). */
export function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // sound not available — the visual alert remains
  }
}

export function elapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
