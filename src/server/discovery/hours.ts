import { DAY_KEYS, openingHoursSchema, type DayKey, type OpeningHours } from '@/lib/opening-hours';

/**
 * Reads weekly opening hours from the shapes restaurants actually publish:
 * - schema.org `openingHoursSpecification` objects,
 * - schema.org / Google `openingHours` strings ("Mo-Fr 11:00-23:00"),
 * - OpenStreetMap `opening_hours` ("Mo-Sa 11:00-23:00; Su off"),
 * - a day-by-day list in the page text ("Monday 11:00 - 23:00 … Sunday Closed").
 *
 * Day and "closed" words are recognised in the five languages MenuNiva supports. Anything that
 * cannot be read with confidence is left out, so the owner fills it in rather than correcting a
 * wrong guess. Every result is validated against the app's own opening-hours schema.
 */

/** Day names and abbreviations in EN, PT, ES, FR plus OSM's two-letter codes. */
const DAY_WORDS: Record<DayKey, string[]> = {
  mon: ['monday', 'mon', 'mo', 'segunda-feira', 'segunda', 'seg', '2a', 'lunes', 'lun', 'lundi', 'l'],
  tue: ['tuesday', 'tues', 'tue', 'tu', 'terca-feira', 'terca', 'ter', '3a', 'martes', 'mar', 'mardi'],
  wed: ['wednesday', 'wed', 'we', 'quarta-feira', 'quarta', 'qua', '4a', 'miercoles', 'mie', 'mercredi', 'mer'],
  thu: ['thursday', 'thurs', 'thur', 'thu', 'th', 'quinta-feira', 'quinta', 'qui', '5a', 'jueves', 'jue', 'jeudi', 'jeu'],
  fri: ['friday', 'fri', 'fr', 'sexta-feira', 'sexta', 'sex', '6a', 'viernes', 'vie', 'vendredi', 'ven'],
  sat: ['saturday', 'sat', 'sa', 'sabado', 'sab', 'samedi', 'sam'],
  sun: ['sunday', 'sun', 'su', 'domingo', 'dom', 'dimanche', 'dim'],
};

const CLOSED_WORDS = /\b(closed|close|fechado|fechada|encerrado|cerrado|ferme|fermee|ferie|off|rest day)\b/;
const ALL_DAY_WORDS = /\b(24\s*\/\s*7|24h|open 24|all day)\b/;

/** Accents removed and punctuation normalised, so "Terça-feira" and "terca feira" match alike. */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u2013|\u2014|\u2212/g, '-')
    .replace(/\u00a0/g, ' ');
}

const byLength = (words: [DayKey, string][]) => words.sort((a, b) => b[1].length - a[1].length);
/** Longest first so "thursday" is not matched as "thu" + leftovers. */
const DAY_LOOKUP = byLength(Object.entries(DAY_WORDS).flatMap(([k, ws]) => ws.map((w) => [k as DayKey, w] as [DayKey, string])));

function dayAt(text: string, from: number): { day: DayKey; end: number } | null {
  for (const [day, word] of DAY_LOOKUP) {
    if (!text.startsWith(word, from)) continue;
    // Must be a whole word: "sat" inside "satisfaction" is not Saturday.
    const after = text[from + word.length];
    if (after && /[a-z0-9]/.test(after)) continue;
    const before = text[from - 1];
    if (before && /[a-z0-9]/.test(before)) continue;
    return { day, end: from + word.length };
  }
  return null;
}

/** "11:00", "11h00", "11.00", "9:30 am", "23h" → "HH:MM", or null. */
function readTime(raw: string): string | null {
  const m = /^(\d{1,2})\s*(?:[:h.]\s*(\d{2}))?\s*(am|pm)?/.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ampm = m[3];
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h === 24 && min === 0) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const TIME = String.raw`\d{1,2}(?:\s*[:h.]\s*\d{2})?\s*(?:am|pm)?`;
const RANGE_RE = new RegExp(String.raw`(${TIME})\s*(?:-|to|a|as|até|ate|hasta|\u00e0|a\b)\s*(${TIME})`, 'g');

/** Every "open-close" pair in a piece of text, in order. */
function readRanges(text: string): { open: string; close: string }[] {
  const out: { open: string; close: string }[] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const open = readTime(m[1]);
    const close = readTime(m[2]);
    // A range that neither advances nor wraps past midnight is unreadable, not "all day".
    if (open && close && open !== close) out.push({ open, close });
    if (out.length >= 3) break;
  }
  return out;
}

const expandSpan = (from: DayKey, to: DayKey): DayKey[] => {
  const a = DAY_KEYS.indexOf(from);
  const b = DAY_KEYS.indexOf(to);
  if (a < 0 || b < 0) return [];
  // Spans may wrap the week, e.g. "Sa-Mo".
  return Array.from({ length: ((b - a + 7) % 7) + 1 }, (_, i) => DAY_KEYS[(a + i) % 7]);
};

/** Day list at the start of a chunk: "mon", "mon-fri", "mon, wed, fri", "mo-sa". */
function readDays(text: string): { days: DayKey[]; rest: string } {
  const days: DayKey[] = [];
  let i = 0;
  for (;;) {
    while (i < text.length && /[\s,;&+|]/.test(text[i])) i++;
    const hit = dayAt(text, i);
    if (!hit) break;
    let end = hit.end;
    let j = end;
    while (j < text.length && /[\s]/.test(text[j])) j++;
    if (text[j] === '-' || text.startsWith('to', j) || text.startsWith('a ', j)) {
      let k = j + (text[j] === '-' ? 1 : text.startsWith('to', j) ? 2 : 1);
      while (k < text.length && /\s/.test(text[k])) k++;
      const second = dayAt(text, k);
      if (second) {
        days.push(...expandSpan(hit.day, second.day));
        end = second.end;
      } else days.push(hit.day);
    } else days.push(hit.day);
    i = end;
    const next = text.slice(i).match(/^[\s,;&+|]*(?=[a-z0-9])/);
    if (!next) break;
  }
  return { days: [...new Set(days)], rest: text.slice(i) };
}

function build(entries: { days: DayKey[]; ranges: { open: string; close: string }[] }[]): OpeningHours | null {
  const hours: Partial<Record<DayKey, { open: string; close: string }[]>> = {};
  for (const e of entries) {
    for (const d of e.days) {
      // First statement for a day wins; later repeats (e.g. a footer) do not overwrite it.
      if (hours[d]) continue;
      hours[d] = e.ranges.slice(0, 3);
    }
  }
  if (!Object.keys(hours).length) return null;
  // A week where every day is empty carries no information.
  if (!Object.values(hours).some((v) => v && v.length)) return null;
  const parsed = openingHoursSchema.safeParse(hours);
  return parsed.success ? parsed.data : null;
}

/**
 * schema.org / OSM style strings, e.g. "Mo-Fr 11:00-23:00", "Sa 11:00-23:30; Su off".
 * Also accepts an array of such strings.
 */
export function parseHoursSpec(input: string | string[]): OpeningHours | null {
  const text = fold(Array.isArray(input) ? input.join('; ') : input);
  const entries: { days: DayKey[]; ranges: { open: string; close: string }[] }[] = [];
  for (const chunk of text.split(/[;\n]+/)) {
    const piece = chunk.trim();
    if (!piece) continue;
    const { days, rest } = readDays(piece);
    const target = days.length ? days : [...DAY_KEYS]; // no day stated = every day
    if (ALL_DAY_WORDS.test(piece)) {
      entries.push({ days: target, ranges: [{ open: '00:00', close: '23:59' }] });
      continue;
    }
    const ranges = readRanges(rest || piece);
    if (!ranges.length && !CLOSED_WORDS.test(piece)) continue;
    entries.push({ days: target, ranges });
  }
  return build(entries);
}

/** schema.org `openingHoursSpecification` entries. */
export function parseHoursSpecification(spec: unknown): OpeningHours | null {
  const list = Array.isArray(spec) ? spec : [spec];
  const entries: { days: DayKey[]; ranges: { open: string; close: string }[] }[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as { dayOfWeek?: unknown; opens?: unknown; closes?: unknown };
    const dayValues = (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek]).filter((d): d is string => typeof d === 'string');
    const days = dayValues.flatMap((d) => {
      // Values are often full URLs: https://schema.org/Monday
      const word = fold(d.split('/').pop() ?? d).trim();
      const hit = dayAt(word, 0);
      return hit ? [hit.day] : [];
    });
    const open = typeof s.opens === 'string' ? readTime(s.opens) : null;
    const close = typeof s.closes === 'string' ? readTime(s.closes) : null;
    // Unreadable times must leave the day unknown. Recording an empty day here would publish it
    // as "closed", which the source never said.
    if (!days.length || !open || !close || open === close) continue;
    entries.push({ days: [...new Set(days)], ranges: [{ open, close }] });
  }
  // Several entries may describe the same day (lunch and dinner): merge instead of dropping.
  const merged = new Map<DayKey, { open: string; close: string }[]>();
  for (const e of entries) for (const d of e.days) merged.set(d, [...(merged.get(d) ?? []), ...e.ranges].slice(0, 3));
  return build([...merged.entries()].map(([d, ranges]) => ({ days: [d], ranges })));
}

/**
 * A day-by-day list in page text, e.g. "Monday 11:00 - 23:00 … Sunday Closed". The text is
 * expected to be already stripped of tags, with separators between cells.
 */
export function parseHoursFromText(text: string): OpeningHours | null {
  const flat = fold(text).replace(/[|•·\t]+/g, ' | ');
  const entries: { days: DayKey[]; ranges: { open: string; close: string }[] }[] = [];
  const seen = new Set<DayKey>();
  // Walk day mentions in order; each one claims the text up to the next day mention.
  const positions: { day: DayKey; start: number; end: number }[] = [];
  for (let i = 0; i < flat.length; i++) {
    const hit = dayAt(flat, i);
    if (!hit) continue;
    positions.push({ day: hit.day, start: i, end: hit.end });
    i = hit.end;
  }
  for (const [idx, pos] of positions.entries()) {
    if (seen.has(pos.day)) continue;
    const until = positions[idx + 1]?.start ?? Math.min(flat.length, pos.end + 80);
    const segment = flat.slice(pos.end, until);
    // Stop at the next day's cell, and never read across a long gap of unrelated prose.
    const window = segment.slice(0, 80);
    const ranges = readRanges(window);
    const closed = CLOSED_WORDS.test(window);
    if (!ranges.length && !closed) continue;
    seen.add(pos.day);
    entries.push({ days: [pos.day], ranges });
  }
  // One or two days alone are more likely a stray match than a published week.
  return entries.length >= 3 ? build(entries) : null;
}

/** How many days of the week a result actually states. */
export function daysCovered(hours: OpeningHours | null | undefined): number {
  return hours ? DAY_KEYS.filter((d) => hours[d] !== undefined).length : 0;
}
