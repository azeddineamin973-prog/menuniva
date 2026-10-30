export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const initialActionState: ActionResult = { ok: false, error: '' };

/** Converts a Zod error into a { field: message } map for forms. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join('.');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

/** Only allow same-site relative redirect targets (prevents open redirects). */
export function safeNextPath(next: unknown, fallback = '/dashboard'): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
