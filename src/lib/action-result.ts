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
  // Browsers drop tabs and line breaks inside addresses, so "/\t/evil.example" would become
  // "//evil.example" (another site): control characters and backslashes are refused outright.
  if (!next.startsWith('/') || next.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
