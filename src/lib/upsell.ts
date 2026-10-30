/** Upsell rule as sent to the guest's browser (no internal data). */
export type UpsellRuleView = { id: string; triggerProductId: string | null; triggerCategoryId: string | null; suggestedProductId: string };

type MenuLike<P> = { id: string; products: P[] }[];

/**
 * Picks polite suggestions for the current cart: only products that are on the guest's menu
 * right now (available, not sold out, priced for this channel), not already in the cart and
 * not dismissed. Rules arrive ordered by priority. Never adds anything by itself.
 */
export function pickSuggestions<P extends { id: string; available: boolean; soldOut: boolean }>(
  rules: UpsellRuleView[],
  menu: MenuLike<P>,
  cartProductIds: string[],
  dismissedRuleIds: string[] = [],
  max = 2,
): { ruleId: string; product: P }[] {
  if (cartProductIds.length === 0) return [];
  const byId = new Map<string, { product: P; categoryId: string }>();
  for (const c of menu) for (const p of c.products) byId.set(p.id, { product: p, categoryId: c.id });
  const inCart = new Set(cartProductIds);
  const cartCategories = new Set(cartProductIds.map((id) => byId.get(id)?.categoryId).filter(Boolean));
  const out: { ruleId: string; product: P }[] = [];
  const used = new Set<string>();
  for (const r of rules) {
    if (out.length >= max) break;
    if (dismissedRuleIds.includes(r.id)) continue;
    const triggered = (r.triggerProductId && inCart.has(r.triggerProductId)) || (r.triggerCategoryId && cartCategories.has(r.triggerCategoryId));
    if (!triggered) continue;
    const s = byId.get(r.suggestedProductId);
    if (!s || !s.product.available || s.product.soldOut || inCart.has(s.product.id) || used.has(s.product.id)) continue;
    used.add(s.product.id);
    out.push({ ruleId: r.id, product: s.product });
  }
  return out;
}
