/** Normalised comparison key: lowercase, no accents/punctuation, collapsed spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of character bigrams (0–1). Deterministic, no AI. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * overlap) / total : 0;
}

export const DUPLICATE_THRESHOLD = 0.85;

/**
 * Groups likely duplicates (e.g. the same dish imported from Glovo and Uber Eats).
 * Items from the same source are never grouped with each other.
 */
export function groupDuplicates<T extends { id: string; name: string; sourceId: string }>(items: T[]): { ids: string[]; confidence: number }[] {
  const groups: { ids: string[]; names: string[]; sources: Set<string>; confidence: number }[] = [];
  for (const it of items) {
    let best: (typeof groups)[number] | null = null;
    let bestScore = 0;
    for (const g of groups) {
      if (g.sources.has(it.sourceId)) continue;
      const score = Math.max(...g.names.map((n) => similarity(n, it.name)));
      if (score >= DUPLICATE_THRESHOLD && score > bestScore) {
        best = g;
        bestScore = score;
      }
    }
    if (best) {
      best.ids.push(it.id);
      best.names.push(it.name);
      best.sources.add(it.sourceId);
      best.confidence = Math.min(best.confidence, bestScore);
    } else groups.push({ ids: [it.id], names: [it.name], sources: new Set([it.sourceId]), confidence: 1 });
  }
  return groups.filter((g) => g.ids.length > 1).map((g) => ({ ids: g.ids, confidence: Math.round(g.confidence * 100) }));
}
