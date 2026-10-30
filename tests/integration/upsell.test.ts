import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { getPublicMenu } from '@/server/services/public-menu';
import { createUpsellRule, deleteUpsellRule, recordUpsellEvent, setUpsellEnabled, setUpsellRuleActive, upsellRulesAdmin, upsellRulesFor } from '@/server/services/upsell';
import { pickSuggestions } from '@/lib/upsell';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

describe('M11-09/10 upsell rules', () => {
  beforeEach(resetDatabase);

  it('creates product and category rules; refuses self-suggestions, duplicates and foreign ids', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Test Restaurant Other');
    const r = await createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: f.tea.id });
    expect(r).toMatchObject({ triggerProductId: f.dish.id, triggerCategoryId: null, suggestedProductId: f.tea.id });
    await createUpsellRule(f.ctx, { trigger: `category:${f.dish.categoryId}`, suggestedProductId: f.tea.id, priority: 5 });
    await expect(createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: f.tea.id })).rejects.toThrow(/already exists/);
    await expect(createUpsellRule(f.ctx, { trigger: `product:${f.tea.id}`, suggestedProductId: f.tea.id })).rejects.toThrow(/cannot suggest itself/);
    await expect(createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: other.tea.id })).rejects.toThrow(/Choose a dish/);
    await expect(createUpsellRule(f.ctx, { trigger: `product:${other.dish.id}`, suggestedProductId: f.tea.id })).rejects.toThrow(/triggers/);
    await expect(createUpsellRule(f.ctx, { trigger: 'evil:1', suggestedProductId: f.tea.id })).rejects.toThrow();
    const pub = await upsellRulesFor(f.org.id);
    expect(pub.map((x) => x.triggerCategoryId)).toEqual([f.dish.categoryId, null]); // higher priority first
    expect(await upsellRulesFor(other.org.id)).toEqual([]);
  });

  it('respects the on/off switch, paused rules and the live menu (sold out is never suggested)', async () => {
    const f = await createOrderingFixture();
    const r = await createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: f.tea.id });
    const menu = await getPublicMenu(f.location.id, 'pt', 'TABLE');
    expect(pickSuggestions(await upsellRulesFor(f.org.id), menu, [f.dish.id]).map((s) => s.product.id)).toEqual([f.tea.id]);
    // Suggested product carries the channel price from the public menu.
    expect(pickSuggestions(await upsellRulesFor(f.org.id), menu, [f.dish.id])[0].product.priceCents).toBe(250);
    // Not on the delivery menu (tea has no delivery price) → not suggested there.
    const delivery = await getPublicMenu(f.location.id, 'pt', 'DELIVERY');
    expect(pickSuggestions(await upsellRulesFor(f.org.id), delivery, [f.dish.id])).toEqual([]);
    await db.menuProduct.update({ where: { id: f.tea.id }, data: { soldOut: true } });
    const soldOutMenu = await getPublicMenu(f.location.id, 'pt', 'TABLE');
    expect(pickSuggestions(await upsellRulesFor(f.org.id), soldOutMenu, [f.dish.id])).toEqual([]);
    await setUpsellRuleActive(f.ctx, r.id, false);
    expect(await upsellRulesFor(f.org.id)).toEqual([]);
    await setUpsellRuleActive(f.ctx, r.id, true);
    await setUpsellEnabled(f.ctx, false);
    expect(await upsellRulesFor(f.org.id)).toEqual([]);
  });

  it('records SHOWN / ACCEPTED counts; rejects unknown or paused rules; tenant-isolated management', async () => {
    const f = await createOrderingFixture();
    const other = await createOrderingFixture('Test Restaurant Other');
    const r = await createUpsellRule(f.ctx, { trigger: `product:${f.dish.id}`, suggestedProductId: f.tea.id });
    await recordUpsellEvent({ ruleId: r.id, type: 'SHOWN' }, 'k');
    await recordUpsellEvent({ ruleId: r.id, type: 'SHOWN' }, 'k');
    await recordUpsellEvent({ ruleId: r.id, type: 'ACCEPTED' }, 'k');
    await expect(recordUpsellEvent({ ruleId: r.id, type: 'ORDERED' }, 'k')).rejects.toThrow();
    await expect(recordUpsellEvent({ ruleId: 'nope', type: 'SHOWN' }, 'k')).rejects.toMatchObject({ code: 'not_found' });
    expect((await upsellRulesAdmin(f.ctx))[0]).toMatchObject({ shown: 2, accepted: 1 });
    expect(await db.upsellEvent.findFirstOrThrow()).toMatchObject({ organizationId: f.org.id, orderId: null });
    expect(await upsellRulesAdmin(other.ctx)).toEqual([]);
    await expect(setUpsellRuleActive(other.ctx, r.id, false)).rejects.toThrow(/not found/);
    await expect(deleteUpsellRule(other.ctx, r.id)).rejects.toThrow(/not found/);
    await setUpsellRuleActive(f.ctx, r.id, false);
    await expect(recordUpsellEvent({ ruleId: r.id, type: 'SHOWN' }, 'k')).rejects.toMatchObject({ code: 'not_found' });
    await deleteUpsellRule(f.ctx, r.id);
    expect(await db.upsellEvent.count()).toBe(0);
  });
});
