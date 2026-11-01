import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/action-result';

/** Where sign-in and sign-up send people afterwards: only paths of this site. */
describe('safeNextPath', () => {
  it('keeps paths of this site', () => {
    for (const p of ['/dashboard', '/invite/abc?x=1#y', '/r/casa-aurora/order/pickup']) expect(safeNextPath(p)).toBe(p);
  });
  it('refuses other sites, including through characters browsers drop from addresses', () => {
    for (const p of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/%09/evil.example'.replace('%09', '\u0009'), '/a\\b', 'https://evil.example', 'evil.example', '', null, 42]) {
      expect(safeNextPath(p, '/fallback'), JSON.stringify(p)).toBe('/fallback');
    }
  });
});
