/**
 * Small colour helpers for restaurant branding. Owners pick any colours they like; these make
 * sure text placed on them stays readable (WCAG contrast), whatever they picked.
 */

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export function toHex([r, g, b]: RGB) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance (WCAG 2.x), 0 = black, 1 = white. */
export function luminance(hex: string) {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const INK = '#171a1d';
export const PAPER = '#ffffff';

/** Near-black or white, whichever reads better on `bg`. */
export function readableOn(bg: string) {
  return contrast(INK, bg) >= contrast(PAPER, bg) ? INK : PAPER;
}

export function isDark(hex: string) {
  return luminance(hex) < 0.18;
}

/** Linear mix of two colours; `t` = share of `b`. */
export function mix(a: string, b: string, t: number) {
  const x = parseHex(a) ?? [255, 255, 255];
  const y = parseHex(b) ?? [255, 255, 255];
  return toHex(x.map((v, i) => v + (y[i] - v) * t) as RGB);
}

/**
 * `color` itself when it reaches `min` contrast on `bg`; otherwise the closest darker (or, on a
 * dark background, lighter) shade that does. Keeps the brand hue for prices and links.
 */
export function ensureContrast(color: string, bg: string, min = 4.5) {
  if (!parseHex(color)) return readableOn(bg);
  if (contrast(color, bg) >= min) return toHex(parseHex(color)!);
  const target = isDark(bg) ? PAPER : INK;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(color, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

export type StorefrontPalette = {
  primary: string;
  accent: string;
  bg: string;
  text: string;
  /** Text on primary-coloured buttons and the header. */
  onPrimary: string;
  /** Primary as a text colour on cards (prices, links). */
  primaryInk: string;
  /** Card / sheet surface. */
  card: string;
  dark: boolean;
};

/** Turns the owner's four brand colours into a palette where every text pairing is readable. */
export function storefrontPalette(b: { primaryColor?: string | null; accentColor?: string | null; backgroundColor?: string | null; textColor?: string | null } | null): StorefrontPalette {
  const valid = (c: string | null | undefined, fallback: string) => (c && parseHex(c) ? toHex(parseHex(c)!) : fallback);
  const primary = valid(b?.primaryColor, '#1f5c4a');
  const accent = valid(b?.accentColor, '#b8975a');
  const bg = valid(b?.backgroundColor, '#fbf7ee');
  const dark = isDark(bg);
  // Cards are white on light backgrounds and a slightly lifted shade of the background on dark ones.
  const card = dark ? mix(bg, PAPER, 0.07) : PAPER;
  const wanted = valid(b?.textColor, '#1e2420');
  const text = contrast(wanted, bg) >= 4.5 && contrast(wanted, card) >= 4.5 ? wanted : readableOn(card);
  return { primary, accent, bg, text, onPrimary: readableOn(primary), primaryInk: ensureContrast(primary, card), card, dark };
}
