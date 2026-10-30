import { percentOfCents } from './money';

/**
 * Deterministic promotion engine (Part 13). Pure integer arithmetic; runs on the server for
 * every quote and order. Rules:
 * - each promotion only discounts what is still undiscounted on its eligible lines,
 *   so the same euro is never discounted twice,
 * - promotions are applied by priority (then by size); a non-combinable promotion is never
 *   applied together with another promotion,
 * - the total discount can never exceed the subtotal (no negative totals).
 */

export type PromoLine = { key: string; productId: string; categoryId: string; unitCents: number; quantity: number };

export type PromoRule = {
  id: string;
  name: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y' | 'COMBO';
  percentBasisPoints: number | null;
  amountCents: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  comboPriceCents: number | null;
  productIds: string[];
  categoryIds: string[];
  minOrderCents: number;
  priority: number;
  combinable: boolean;
  couponCode?: string | null;
};

export type AppliedDiscount = { promotionId: string; description: string; amountCents: number; couponCode?: string | null };

function eligible(rule: PromoRule, line: PromoLine) {
  if (rule.type === 'COMBO') return rule.productIds.includes(line.productId);
  if (!rule.productIds.length && !rule.categoryIds.length) return true;
  return rule.productIds.includes(line.productId) || rule.categoryIds.includes(line.categoryId);
}

/** Discount for one rule given what remains undiscounted per line (cents). */
function discountFor(rule: PromoRule, lines: PromoLine[], remaining: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const el = lines.filter((l) => eligible(rule, l) && (remaining.get(l.key) ?? 0) > 0);
  if (!el.length) return out;
  const pool = el.reduce((s, l) => s + remaining.get(l.key)!, 0);
  const spread = (total: number) => {
    // distribute proportionally (largest remainder), never more than what remains on a line
    let left = Math.min(total, pool);
    el.forEach((l, i) => {
      const r = remaining.get(l.key)!;
      const share = i === el.length - 1 ? left : Math.min(r, Math.floor((total * r) / pool));
      const v = Math.min(share, left, r);
      if (v > 0) out.set(l.key, v);
      left -= v;
    });
  };
  if (rule.type === 'PERCENTAGE' && rule.percentBasisPoints) {
    for (const l of el) {
      const v = percentOfCents(remaining.get(l.key)!, rule.percentBasisPoints);
      if (v > 0) out.set(l.key, v);
    }
  } else if (rule.type === 'FIXED_AMOUNT' && rule.amountCents) {
    spread(rule.amountCents);
  } else if (rule.type === 'BUY_X_GET_Y' && rule.buyQuantity && rule.getQuantity) {
    // Expand to units, most expensive first; in each group of X+Y units, the cheapest Y are free.
    const units = el.flatMap((l) => Array.from({ length: l.quantity }, () => ({ key: l.key, cents: l.unitCents }))).sort((a, b) => b.cents - a.cents);
    const size = rule.buyQuantity + rule.getQuantity;
    for (let g = 0; g + size <= units.length; g += size) {
      for (const u of units.slice(g + rule.buyQuantity, g + size)) out.set(u.key, (out.get(u.key) ?? 0) + u.cents);
    }
    for (const [k, v] of out) out.set(k, Math.min(v, remaining.get(k) ?? 0));
  } else if (rule.type === 'COMBO' && rule.comboPriceCents !== null && rule.productIds.length > 1) {
    // Number of complete sets = min quantity across the combo's products.
    const qty = (pid: string) => el.filter((l) => l.productId === pid).reduce((s, l) => s + l.quantity, 0);
    const sets = Math.min(...rule.productIds.map(qty));
    if (sets > 0) {
      const cheapest = rule.productIds.map((pid) => Math.min(...el.filter((l) => l.productId === pid).map((l) => l.unitCents)));
      const regular = cheapest.reduce((s, c) => s + c, 0);
      const saving = (regular - rule.comboPriceCents) * sets;
      if (saving > 0) spread(saving);
    }
  }
  return out;
}

export function applyPromotions(lines: PromoLine[], rules: PromoRule[], subtotalCents: number): { discounts: AppliedDiscount[]; totalCents: number } {
  const usable = rules.filter((r) => subtotalCents >= r.minOrderCents);
  const remaining = new Map(lines.map((l) => [l.key, l.unitCents * l.quantity]));
  // Rank by priority, then by how much each would save on its own.
  const ranked = usable
    .map((r) => ({ r, solo: [...discountFor(r, lines, remaining).values()].reduce((s, v) => s + v, 0) }))
    .filter((x) => x.solo > 0)
    .sort((a, b) => b.r.priority - a.r.priority || b.solo - a.solo);
  const applied: AppliedDiscount[] = [];
  const chosen: PromoRule[] = [];
  for (const { r } of ranked) {
    if (chosen.length && (!r.combinable || chosen.some((c) => !c.combinable))) continue;
    const d = discountFor(r, lines, remaining);
    const amount = [...d.values()].reduce((s, v) => s + v, 0);
    if (amount <= 0) continue;
    for (const [k, v] of d) remaining.set(k, (remaining.get(k) ?? 0) - v);
    applied.push({ promotionId: r.id, description: r.name, amountCents: amount, couponCode: r.couponCode ?? null });
    chosen.push(r);
  }
  const total = Math.min(subtotalCents, applied.reduce((s, a) => s + a.amountCents, 0));
  return { discounts: applied, totalCents: total };
}
