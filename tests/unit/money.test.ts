import { describe, expect, it } from 'vitest';
import { centsToInputValue, formatCents, parseMoneyToCents, percentOfCents, sumCents } from '@/lib/money';

describe('parseMoneyToCents', () => {
  it.each([
    ['16,90', 1690],
    ['16.90', 1690],
    ['€ 16,90', 1690],
    ['17', 1700],
    ['17,5', 1750],
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['0,99', 99],
    [16.9, 1690],
    [0.1 + 0.2, 30],
  ])('parses %s → %i', (input, cents) => {
    expect(parseMoneyToCents(input as string | number)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '16,999', '1.234', '12€a', '1,2,3,4,5', ','])('rejects ambiguous or invalid %s', (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe('money arithmetic is integer-only', () => {
  it('percentage rounds half up to the cent', () => {
    expect(percentOfCents(1690, 1000)).toBe(169); // 10 %
    expect(percentOfCents(1695, 1000)).toBe(170); // 169.5 → 170
    expect(percentOfCents(1, 5000)).toBe(1); // 0.5 → 1
  });
  it('sums safely', () => {
    expect(sumCents([1690, 1750, 250])).toBe(3690);
  });
  it('formats for display', () => {
    expect(formatCents(1690, 'pt-PT')).toMatch(/16,90\s€/);
    expect(centsToInputValue(1690)).toBe('16.90');
    expect(centsToInputValue(5)).toBe('0.05');
  });
});
