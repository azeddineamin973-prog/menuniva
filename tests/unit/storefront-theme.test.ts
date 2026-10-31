import { describe, expect, it } from 'vitest';
import { contrast, storefrontPalette } from '@/lib/color';
import { THEME_KEYS, THEME_PRESETS } from '@/lib/storefront-themes';

const AA = 4.5;

describe('storefront theme presets', () => {
  it.each(THEME_PRESETS.map((p) => [p.key, p] as const))('%s: every text pairing on the guest menu is readable', (_key, t) => {
    const p = storefrontPalette({ themePreset: t.key, primaryColor: t.primary, accentColor: t.accent, backgroundColor: t.background, textColor: t.text });
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.text, p.card)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.onSecondary, p.secondary)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.primaryInk, p.card)).toBeGreaterThanOrEqual(AA);
    // A preset supplies its own surface and secondary colours.
    expect(p.card).toBe(t.surface.toLowerCase());
    expect(p.secondary).toBe(t.secondary.toLowerCase());
  });

  it('custom colours derive surface and secondary, and stay readable', () => {
    const p = storefrontPalette({ themePreset: 'custom', primaryColor: '#B9FF36', accentColor: '#FF00AA', backgroundColor: '#1A1A2E', textColor: '#333333' });
    expect(p.dark).toBe(true);
    expect(contrast(p.text, p.card)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.onSecondary, p.secondary)).toBeGreaterThanOrEqual(AA);
  });

  it('a preset whose background the owner changed falls back to derived colours', () => {
    const p = storefrontPalette({ themePreset: 'midnight', primaryColor: '#E8C46A', accentColor: '#E8C46A', backgroundColor: '#FFFFFF', textColor: '#111111' });
    expect(p.card).toBe('#ffffff');
    expect(p.dark).toBe(false);
  });

  it('the saved theme key is one of the presets or custom', () => {
    expect(THEME_KEYS).toEqual(['classic', 'moroccan', 'minimal', 'bistro', 'fresh', 'terracotta', 'midnight', 'custom']);
  });
});
