'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ButtonLink } from '@/components/ui';
import { classifyResponse, connectionState, PROBLEM_RETRY_MS, retryDelay, timeoutFor, type ConnectionState, type PollProblem } from '@/lib/poll-health';

/**
 * Near-real-time updates by polling (clearly labelled in the UI; MenuNiva does not use
 * WebSockets). Reports honest connection health (audit OPS-03, OPS-47):
 * - every request has a timeout (≈ two intervals) and is aborted when it hangs, so one stalled
 *   request never blocks the polls after it;
 * - failures retry quickly once, then back off (15 s at most on order boards, 30 s for the
 *   sidebar counts); reconnecting, showing the tab again
 *   or `refresh()` (after a staff action) fetch at once from the server;
 * - only one request runs at a time and an answer is applied only if it belongs to the newest
 *   request, so an older answer arriving late never replaces newer data;
 * - signed out (401), no access (403 / not a member) and "location or station not found" (404)
 *   are reported as such, re-checked every 15 s, and clear as soon as they are fixed.
 */
export type PollHealth = { lastOk: Date | null; failures: number; problem: PollProblem | null; browserOffline: boolean; intervalMs: number };
type Snapshot<T> = { url: string; data: T | null; lastOk: Date | null; failures: number; problem: PollProblem | null };
type Poll = (mode: 'tick' | 'now') => Promise<void>;

export function usePolling<T>(url: string, intervalMs: number) {
  const [snap, setSnap] = useState<Snapshot<T>>({ url, data: null, lastOk: null, failures: 0, problem: null });
  const [browserOffline, setBrowserOffline] = useState(false);
  const pollRef = useRef<Poll | null>(null);

  useEffect(() => {
    let alive = true;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    let failures = 0;
    const timeoutMs = timeoutFor(intervalMs);
    // Results of another URL (e.g. the previous location) are never mixed into this one's.
    const patch = (p: Partial<Snapshot<T>>) => setSnap((s) => ({ ...(s.url === url ? s : { url, data: null, lastOk: null, failures: 0, problem: null }), ...p }));
    const fail = () => {
      failures += 1;
      patch({ failures, problem: null });
      return retryDelay(failures, intervalMs);
    };

    const poll: Poll = async (mode) => {
      // A scheduled tick waits for the running request (it ends by answer or timeout); an explicit
      // refresh replaces it, so the newest request always wins.
      if (mode === 'tick' && ctrl) return;
      ctrl?.abort();
      clearTimeout(timer);
      const c = new AbortController();
      ctrl = c;
      const mine = ++seq;
      const timeout = setTimeout(() => c.abort(), timeoutMs);
      let next = intervalMs;
      try {
        const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: c.signal });
        const body: unknown = await r.json().catch(() => null);
        if (mine !== seq || !alive) return; // replaced by a newer request: its answer counts, not this one
        const out = classifyResponse(r.status, body, r.headers.get('Retry-After'));
        if (out.kind === 'ok') {
          failures = 0;
          patch({ data: body as T, lastOk: new Date(), failures: 0, problem: null });
        } else if (out.kind === 'problem') {
          next = PROBLEM_RETRY_MS;
          patch({ problem: out.problem });
        } else {
          const backoff = fail();
          next = out.retryAfterMs ?? backoff;
        }
      } catch {
        // Network error, offline, or aborted by the timeout.
        if (mine !== seq || !alive) return;
        next = fail();
      } finally {
        clearTimeout(timeout);
        if (mine === seq && alive) {
          ctrl = null;
          timer = setTimeout(() => void poll('tick'), next);
        }
      }
    };
    pollRef.current = poll;

    const onOnline = () => {
      setBrowserOffline(false);
      failures = 0;
      void poll('now');
    };
    const onOffline = () => setBrowserOffline(true);
    const onVisible = () => document.visibilityState === 'visible' && void poll('now');
    void poll('now');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      seq += 1;
      ctrl?.abort();
      clearTimeout(timer);
      if (pollRef.current === poll) pollRef.current = null;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, intervalMs]);

  /** Fetch now (after a staff action): replaces a running request; resolves when answered. */
  const refresh = useCallback(() => pollRef.current?.('now') ?? Promise.resolve(), []);
  const current = snap.url === url ? snap : null;
  const health: PollHealth = { lastOk: current?.lastOk ?? null, failures: current?.failures ?? 0, problem: current?.problem ?? null, browserOffline, intervalMs };
  return { data: current?.data ?? null, health, refresh };
}

/** Connected / Reconnecting / Offline right now, re-evaluated every `tickMs` (a hanging request turns it without any event). */
export function useConnectionState(health: PollHealth, tickMs = 1000): { state: ConnectionState; now: number; stale: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  const state = connectionState({ lastOkAt: health.lastOk?.getTime() ?? null, failures: health.failures, browserOffline: health.browserOffline, now: Math.max(now, health.lastOk?.getTime() ?? 0), intervalMs: health.intervalMs });
  return { state, now, stale: !!health.problem || state === 'reconnecting' || state === 'offline' };
}

export type ConnectionLabels = { live: string; lost: string; reconnecting?: string; connecting?: string; lastUpdate?: string };
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function ConnectionBadge({ health, labels }: { health: PollHealth; labels?: ConnectionLabels }) {
  const { state, now } = useConnectionState(health, 1000);
  const l = { live: 'Live · refreshes every {s} s', lost: 'Connection lost — retrying. Orders are safe on the server.', reconnecting: 'Reconnecting…', connecting: 'Connecting…', lastUpdate: 'last update {time} ({ago} ago)', ...labels };
  const last = health.lastOk;
  const tone =
    state === 'live' ? 'border-success/25 bg-success/10 text-success' : state === 'reconnecting' ? 'border-warning/30 bg-warning/10 text-warning' : state === 'offline' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-surface-2 text-muted';
  const text =
    state === 'live'
      ? fill(l.live, { s: String(Math.round(health.intervalMs / 1000)) })
      : state === 'reconnecting'
        ? l.reconnecting
        : state === 'offline'
          ? l.lost
          : l.connecting;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${tone}`} role="status" data-testid="connection-status" data-state={state}>
      <span className={`h-2 w-2 rounded-full ${state === 'live' ? 'bg-success' : state === 'reconnecting' ? 'animate-pulse bg-warning' : state === 'offline' ? 'animate-pulse bg-danger' : 'bg-muted'}`} aria-hidden />
      {text}
      {last && <span className="opacity-70">· {state === 'live' ? clock(last) : fill(l.lastUpdate, { time: clock(last), ago: elapsed(last.toISOString(), now) })}</span>}
    </span>
  );
}

/**
 * A banner over a board whose data stopped updating: says since when, so nobody acts on an old
 * list without knowing it. Hidden while live.
 */
export function StaleBanner({ health, text }: { health: PollHealth; text: string }) {
  const { state, now } = useConnectionState(health, 1000);
  if (!health.lastOk || (state !== 'reconnecting' && state !== 'offline')) return null;
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${state === 'offline' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-warning/30 bg-warning/10 text-warning'}`}
      role="alert"
      data-testid="stale-banner"
      data-state={state}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full ${state === 'offline' ? 'bg-danger' : 'bg-warning'}`} aria-hidden />
      {fill(text, { time: clock(health.lastOk), ago: elapsed(health.lastOk.toISOString(), now) })}
    </p>
  );
}

export type ProblemLabels = { expired: string; forbidden: string; notFound: string; signIn: string; /** Label of the `backHref` button. */ back?: string };

/**
 * Shown instead of a board when the server says it cannot be shown: signed out, no access, or the
 * location / station is gone. Each says what happened (a missing location is not "session
 * expired") and the board comes back by itself once fixed (the hook keeps re-checking).
 */
export function PollProblemNotice({ problem, labels, backHref }: { problem: PollProblem; labels: ProblemLabels; backHref?: string }) {
  const [next] = useState(() => (typeof window === 'undefined' ? '' : window.location.pathname + window.location.search));
  const text = problem === 'expired' ? labels.expired : problem === 'forbidden' ? labels.forbidden : labels.notFound;
  return (
    <Alert
      tone={problem === 'not_found' ? 'warning' : 'danger'}
      action={
        problem === 'expired' ? (
          <ButtonLink href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} size="sm" variant="secondary">
            {labels.signIn}
          </ButtonLink>
        ) : problem === 'not_found' && backHref && labels.back ? (
          <ButtonLink href={backHref} size="sm" variant="secondary">
            {labels.back}
          </ButtonLink>
        ) : undefined
      }
    >
      <span data-testid="poll-problem" data-problem={problem}>
        {text}
      </span>
    </Alert>
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
