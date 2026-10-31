import { describe, expect, it } from 'vitest';
import { normalizeCategoryName, suggestStationType } from '@/server/services/station-assign';

describe('station suggestions from a category name', () => {
  it('recognises drinks and desserts in the five supported languages', () => {
    const cafe = ['Bebidas', 'Chá', 'Cafés', 'Drinks', 'Hot drinks', 'Boissons', 'Jus', 'Zumos', 'Refrescos', 'Água', 'شاي', 'مشروبات'];
    for (const name of cafe) expect(suggestStationType(name), name).toBe('CAFE');
    const desserts = ['Sobremesas', 'Desserts', 'Postres', 'Doces', 'Gelados', 'Pastelaria', 'Gâteaux', 'حلويات'];
    for (const name of desserts) expect(suggestStationType(name), name).toBe('DESSERTS');
  });

  it('ignores accents and case, and reads run-together names', () => {
    expect(suggestStationType('CHÁ')).toBe('CAFE');
    expect(suggestStationType('cha')).toBe('CAFE');
    expect(suggestStationType('BebidasQuentes')).toBe('CAFE');
    expect(normalizeCategoryName('Sobremesas Caseiras')).toBe('sobremesas caseiras');
  });

  it('returns nothing for food and for anything it cannot place, instead of guessing', () => {
    // A wrong station silently sends orders to a screen nobody is watching, so no match must
    // mean "ask the owner", never "probably the kitchen".
    for (const name of ['Tajines', 'Entradas', 'Pratos principais', 'Grelhados', 'Pizzas', 'Couscous', 'House specials']) {
      expect(suggestStationType(name), name).toBeNull();
    }
  });

  it('does not match a keyword hidden inside an unrelated word', () => {
    // "cha" must not fire on "Chateaubriand", and "the" (French tea) must not fire on English text.
    expect(suggestStationType('Chateaubriand')).toBeNull();
    expect(suggestStationType('The best of the house')).toBeNull();
    expect(suggestStationType('Pratos do chefe')).toBeNull();
  });
});
