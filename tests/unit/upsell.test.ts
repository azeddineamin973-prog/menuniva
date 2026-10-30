import { describe, expect, it } from 'vitest';
import { pickSuggestions, type UpsellRuleView } from '@/lib/upsell';

const p = (id: string, extra: Partial<{ available: boolean; soldOut: boolean }> = {}) => ({ id, available: true, soldOut: false, ...extra });
const menu = [
  { id: 'mains', products: [p('tagine'), p('couscous')] },
  { id: 'drinks', products: [p('tea'), p('juice', { soldOut: true }), p('coffee', { available: false })] },
  { id: 'desserts', products: [p('pastry')] },
];
const rule = (id: string, trigger: string, suggested: string): UpsellRuleView => ({
  id,
  triggerProductId: trigger.startsWith('cat:') ? null : trigger,
  triggerCategoryId: trigger.startsWith('cat:') ? trigger.slice(4) : null,
  suggestedProductId: suggested,
});

describe('M11-10 cart suggestions', () => {
  it('product and category triggers; priority order kept; at most two', () => {
    const rules = [rule('r1', 'tagine', 'tea'), rule('r2', 'cat:mains', 'pastry'), rule('r3', 'tagine', 'couscous')];
    expect(pickSuggestions(rules, menu, ['tagine']).map((s) => s.product.id)).toEqual(['tea', 'pastry']);
    expect(pickSuggestions(rules, menu, ['couscous']).map((s) => s.product.id)).toEqual(['pastry']);
  });
  it('never suggests what is already in the cart, sold out, unavailable or not on this menu', () => {
    const rules = [rule('a', 'tagine', 'juice'), rule('b', 'tagine', 'coffee'), rule('c', 'tagine', 'ghost'), rule('d', 'tagine', 'tea')];
    expect(pickSuggestions(rules, menu, ['tagine', 'tea'])).toEqual([]);
  });
  it('empty cart → nothing; dismissed suggestions stay hidden; duplicates collapse', () => {
    const rules = [rule('a', 'tagine', 'tea'), rule('b', 'cat:mains', 'tea'), rule('c', 'cat:mains', 'pastry')];
    expect(pickSuggestions(rules, menu, [])).toEqual([]);
    expect(pickSuggestions(rules, menu, ['tagine']).map((s) => s.ruleId)).toEqual(['a', 'c']);
    expect(pickSuggestions(rules, menu, ['tagine'], ['a']).map((s) => s.ruleId)).toEqual(['b', 'c']);
  });
});
