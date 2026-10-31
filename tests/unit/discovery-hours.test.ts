import { describe, expect, it } from 'vitest';
import { daysCovered, parseHoursFromText, parseHoursSpec, parseHoursSpecification } from '@/server/discovery/hours';

describe('opening hours from schema.org / OSM strings', () => {
  it('reads day spans and lists', () => {
    expect(parseHoursSpec('Mo-Fr 11:00-23:00')).toEqual({
      mon: [{ open: '11:00', close: '23:00' }],
      tue: [{ open: '11:00', close: '23:00' }],
      wed: [{ open: '11:00', close: '23:00' }],
      thu: [{ open: '11:00', close: '23:00' }],
      fri: [{ open: '11:00', close: '23:00' }],
    });
    expect(parseHoursSpec(['Mo-Sa 11:00-23:30', 'Su off'])).toMatchObject({ mon: [{ open: '11:00', close: '23:30' }], sun: [] });
    expect(parseHoursSpec('Mon, Wed, Fri 09:00-17:00')).toMatchObject({ mon: [{ open: '09:00', close: '17:00' }], wed: [{ open: '09:00', close: '17:00' }], fri: [{ open: '09:00', close: '17:00' }] });
  });

  it('reads two sittings a day and a span that wraps the week', () => {
    expect(parseHoursSpec('Tu-We 12:00-15:00,19:00-23:00')?.tue).toEqual([
      { open: '12:00', close: '15:00' },
      { open: '19:00', close: '23:00' },
    ]);
    expect(Object.keys(parseHoursSpec('Sa-Mo 10:00-14:00') ?? {}).sort()).toEqual(['mon', 'sat', 'sun']);
  });

  it('marks stated closed days as closed, not as missing', () => {
    const h = parseHoursSpec('Mo-Sa 11:00-23:00; Su closed');
    expect(h?.sun).toEqual([]);
    expect(daysCovered(h)).toBe(7);
  });

  it('handles 12-hour clocks, "h" separators and past-midnight closing', () => {
    expect(parseHoursSpec('Fr 6:00 pm - 1:00 am')?.fri).toEqual([{ open: '18:00', close: '01:00' }]);
    expect(parseHoursSpec('Sa 11h30-23h00')?.sat).toEqual([{ open: '11:30', close: '23:00' }]);
  });

  it('reads Portuguese, Spanish and French day names', () => {
    expect(parseHoursSpec('Segunda-feira 11:00-23:00')?.mon).toEqual([{ open: '11:00', close: '23:00' }]);
    expect(parseHoursSpec('Terça a Sábado 12:00-22:00')?.tue).toEqual([{ open: '12:00', close: '22:00' }]);
    expect(parseHoursSpec('Lunes a Viernes 13:00-16:00')?.fri).toEqual([{ open: '13:00', close: '16:00' }]);
    expect(parseHoursSpec('Dimanche 10:00-15:00')?.sun).toEqual([{ open: '10:00', close: '15:00' }]);
  });

  it('returns nothing for text with no readable hours', () => {
    expect(parseHoursSpec('')).toBeNull();
    expect(parseHoursSpec('open for lunch and dinner')).toBeNull();
    expect(parseHoursSpec('call us')).toBeNull();
  });
});

describe('opening hours from schema.org specifications', () => {
  it('reads dayOfWeek URLs and merges lunch with dinner', () => {
    const h = parseHoursSpecification([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'], opens: '12:00', closes: '15:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '19:00', closes: '23:00' },
    ]);
    expect(h?.mon).toEqual([
      { open: '12:00', close: '15:00' },
      { open: '19:00', close: '23:00' },
    ]);
    expect(h?.tue).toEqual([{ open: '12:00', close: '15:00' }]);
  });

  it('ignores malformed entries instead of guessing', () => {
    expect(parseHoursSpecification([{ dayOfWeek: 'Someday', opens: '10:00', closes: '20:00' }])).toBeNull();
    expect(parseHoursSpecification(null)).toBeNull();
    expect(parseHoursSpecification([{ dayOfWeek: 'Monday', opens: 'noon', closes: 'late' }])).toBeNull();
  });

  it('leaves a day unknown when its times are unreadable, instead of calling it closed', () => {
    const h = parseHoursSpecification([
      { dayOfWeek: 'Monday', opens: '12:00', closes: '15:00' },
      { dayOfWeek: 'Tuesday', opens: 'noon', closes: 'late' },
    ]);
    expect(h).toEqual({ mon: [{ open: '12:00', close: '15:00' }] });
    expect(h?.tue).toBeUndefined(); // not [] — "closed" was never stated
  });
});

describe('opening hours from page text', () => {
  // The real Casa de Marrocos contact block, as the site renders it (tags already stripped).
  const REAL = 'Opening Hours | Monday | 11:00 - 23:00 | Tuesday | 11:00 - 23:00 | Wednesday | 11:00 - 23:00 | Thursday | 11:00 - 23:00 | Friday | 11:00 - 23:00 | Saturday | 11:00 - 23:30 | Sunday | Closed';

  it('reads a full week from a real restaurant page', () => {
    const h = parseHoursFromText(REAL);
    expect(h).toEqual({
      mon: [{ open: '11:00', close: '23:00' }],
      tue: [{ open: '11:00', close: '23:00' }],
      wed: [{ open: '11:00', close: '23:00' }],
      thu: [{ open: '11:00', close: '23:00' }],
      fri: [{ open: '11:00', close: '23:00' }],
      sat: [{ open: '11:00', close: '23:30' }],
      sun: [],
    });
    expect(daysCovered(h)).toBe(7);
  });

  it('does not read hours out of unrelated prose', () => {
    expect(parseHoursFromText('Sunday roast is our speciality. Book a table today!')).toBeNull();
    // A single stray day mention is not a published week.
    expect(parseHoursFromText('Closed on Monday for renovations')).toBeNull();
  });

  it('is not fooled by day names inside other words', () => {
    expect(parseHoursFromText('Satisfaction guaranteed 11:00 - 23:00 | Sunglasses 10:00 - 12:00 | Momentum 09:00 - 10:00')).toBeNull();
  });

  it('keeps the first statement when a page repeats hours in its footer', () => {
    const h = parseHoursFromText('Monday 11:00 - 23:00 | Tuesday 11:00 - 23:00 | Wednesday 11:00 - 23:00 | Monday 09:00 - 10:00');
    expect(h?.mon).toEqual([{ open: '11:00', close: '23:00' }]);
  });
});
