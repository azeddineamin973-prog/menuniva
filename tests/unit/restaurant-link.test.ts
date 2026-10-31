import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, readableOn, storefrontPalette } from '@/lib/color';
import { displayUrl, isLocalBaseUrl, restaurantPath, restaurantUrl } from '@/lib/restaurant-link';

describe('restaurant link', () => {
  it('matches the storefront routing: slug only for one location, slug/location for several', () => {
    expect(restaurantPath('casa-aurora', 'centro', false)).toBe('/r/casa-aurora');
    expect(restaurantPath('casa-aurora', 'centro', true)).toBe('/r/casa-aurora/centro');
    expect(restaurantUrl('https://menuniva.com/', '/r/casa-aurora')).toBe('https://menuniva.com/r/casa-aurora');
    expect(displayUrl('https://menuniva.com/r/casa-aurora')).toBe('menuniva.com/r/casa-aurora');
  });

  it('flags addresses guests cannot reach', () => {
    for (const u of ['http://localhost:3000', 'https://localhost', 'https://127.0.0.1:3300', 'https://192.168.1.10', 'https://10.0.0.2', 'https://172.20.1.1', 'https://shop.local', 'http://menuniva.com', 'not a url']) {
      expect(isLocalBaseUrl(u), u).toBe(true);
    }
    for (const u of ['https://menuniva.com', 'https://menuniva.vercel.app', 'https://172.32.0.1']) expect(isLocalBaseUrl(u), u).toBe(false);
  });
});

describe('storefront palette contrast', () => {
  it('picks readable text on any brand colour', () => {
    expect(readableOn('#b9ff36')).toBe('#171a1d'); // lime header gets dark text
    expect(readableOn('#1f5c4a')).toBe('#ffffff');
    expect(contrast(ensureContrast('#b9ff36', '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the owner colours when they already read well', () => {
    const p = storefrontPalette({ primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420' });
    expect(p).toMatchObject({ primary: '#1f5c4a', text: '#1e2420', onPrimary: '#ffffff', primaryInk: '#1f5c4a', card: '#ffffff', dark: false });
  });

  it('dark backgrounds get dark cards and light text, even if the chosen text colour is dark', () => {
    const p = storefrontPalette({ primaryColor: '#c9a227', accentColor: '#c9a227', backgroundColor: '#101214', textColor: '#222222' });
    expect(p.dark).toBe(true);
    expect(contrast(p.text, p.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.primaryInk, p.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('ignores invalid colours', () => {
    expect(storefrontPalette({ primaryColor: 'red; background:url(x)', backgroundColor: null }).primary).toBe('#1f5c4a');
  });
});
