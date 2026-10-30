import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));
const { effectiveModules, MODULES } = await import('@/lib/modules');
const { csvCell, resolveRange } = await import('@/server/services/analytics');

describe('M12-09 effective modules', () => {
  const starter = ['table_ordering', 'kds', 'translations', 'import', 'feedback'];
  it('plan features, add-ons and switched-off modules', () => {
    expect([...effectiveModules({ planFeatures: starter, trialActive: false, trialIncludesAll: true, enabled: [], disabled: [] })].sort()).toEqual([...starter].sort());
    const s = effectiveModules({ planFeatures: starter, trialActive: false, trialIncludesAll: true, enabled: ['loyalty', 'bogus'], disabled: ['feedback'] });
    expect(s.has('loyalty')).toBe(true);
    expect(s.has('feedback')).toBe(false);
    expect(s.has('bogus' as never)).toBe(false);
  });
  it('an active trial includes everything only when the platform allows it; switched-off still wins', () => {
    expect(effectiveModules({ planFeatures: starter, trialActive: true, trialIncludesAll: true, enabled: [], disabled: ['delivery'] }).size).toBe(MODULES.length - 1);
    expect(effectiveModules({ planFeatures: starter, trialActive: true, trialIncludesAll: false, enabled: [], disabled: [] }).has('delivery')).toBe(false);
    expect(effectiveModules({ planFeatures: null, trialActive: false, trialIncludesAll: true, enabled: [], disabled: [] }).size).toBe(0);
  });
});

describe('M12-01 date ranges in the location time zone', () => {
  it('today in Lisbon vs Madrid at the same instant', () => {
    const now = new Date('2026-11-01T23:30:00Z'); // 23:30 in Lisbon, 00:30 on Nov 2 in Madrid
    const lis = resolveRange('Europe/Lisbon', 'today', undefined, undefined, now);
    expect([lis.from, lis.start.toISOString(), lis.end.toISOString()]).toEqual(['2026-11-01', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z']);
    const mad = resolveRange('Europe/Madrid', 'today', undefined, undefined, now);
    expect([mad.from, mad.start.toISOString(), mad.end.toISOString()]).toEqual(['2026-11-02', '2026-11-01T23:00:00.000Z', '2026-11-02T23:00:00.000Z']);
  });
  it('7 / 30 days include today; custom is inclusive and ordered; the autumn DST day has 25 hours', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    expect(resolveRange('Europe/Lisbon', '7d', undefined, undefined, now).days).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(resolveRange('Europe/Lisbon', '30d', undefined, undefined, now).days).toHaveLength(30);
    const dst = resolveRange('Europe/Lisbon', 'custom', '2026-10-25', '2026-10-25', now); // clocks go back on 25 Oct 2026
    expect((dst.end.getTime() - dst.start.getTime()) / 3600_000).toBe(25);
    const swapped = resolveRange('Europe/Lisbon', 'custom', '2026-10-10', '2026-10-01', now);
    expect([swapped.from, swapped.to, swapped.days.length]).toEqual(['2026-10-01', '2026-10-10', 10]);
    expect(resolveRange('Europe/Lisbon', 'custom', 'nonsense', '2026-10-01', now).preset).toBe('today');
    expect(() => resolveRange('Europe/Lisbon', 'custom', '2024-01-01', '2026-01-01', now)).toThrow(/one year/);
  });
});

describe('M12-04 CSV cells', () => {
  it('quotes separators and neutralises formulas, keeps negative numbers', () => {
    expect(csvCell('Tajine, frango')).toBe('"Tajine, frango"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+351 900')).toBe("'+351 900");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(null)).toBe('');
  });
});
