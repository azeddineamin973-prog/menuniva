import { describe, expect, it } from 'vitest';
import { dirOf, fmt, getMessages, LANGUAGES } from '@/i18n';

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('five-language dictionaries', () => {
  const reference = keys(getMessages('en')).sort();

  it.each(LANGUAGES)('%s has exactly the same keys as English', (lang) => {
    expect(keys(getMessages(lang)).sort()).toEqual(reference);
  });

  it.each(LANGUAGES)('%s has no empty strings', (lang) => {
    const flat = keys(getMessages(lang));
    const m = getMessages(lang) as unknown as Record<string, Record<string, unknown>>;
    for (const k of flat) {
      const value = k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], m);
      expect(typeof value === 'string' && value.trim().length > 0, `${lang}:${k}`).toBe(true);
    }
  });

  it('Arabic is right-to-left, others left-to-right', () => {
    expect(dirOf('ar')).toBe('rtl');
    for (const l of ['pt', 'en', 'fr', 'es'] as const) expect(dirOf(l)).toBe('ltr');
  });

  it('interpolates variables', () => {
    expect(fmt(getMessages('pt').customer.table, { label: '05' })).toBe('Mesa 05');
    expect(fmt(getMessages('ar').customer.table, { label: '05' })).toBe('طاولة 05');
  });
});
