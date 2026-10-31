import { beforeEach, describe, expect, it } from 'vitest';
import type { LanguageCode } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { approveAllMachineTranslations, translateMissing, translationPlan } from '@/server/services/ai-translate';
import { getPublicMenu } from '@/server/services/public-menu';
import { getSetupProgress } from '@/server/services/setup-progress';
import { getTranslationGrid } from '@/server/services/translations';
import { TranslationUnavailableError, type TranslationProvider } from '@/server/translation/types';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/** Stand-in provider: prefixes each input, so what was translated and from where is visible. */
class FakeProvider implements TranslationProvider {
  readonly id = 'openrouter' as const;
  readonly label = 'Fake';
  calls: { texts: string[]; from: LanguageCode; to: LanguageCode }[] = [];
  constructor(private readonly behaviour: 'ok' | 'fail' | 'short' | 'empty' = 'ok') {}
  isConfigured() {
    return true;
  }
  async translate(texts: string[], from: LanguageCode, to: LanguageCode) {
    this.calls.push({ texts, from, to });
    if (this.behaviour === 'fail') throw new TranslationUnavailableError('Provider is down.');
    if (this.behaviour === 'short') return texts.slice(1).map((t) => `[${to}] ${t}`);
    if (this.behaviour === 'empty') return texts.map(() => '');
    return texts.map((t) => (t ? `[${to}] ${t}` : ''));
  }
}

const SOURCE = 'pt';
const pt = async (f: Awaited<ReturnType<typeof createOrderingFixture>>) =>
  db.restaurantOrganization.update({ where: { id: f.org.id }, data: { sourceLanguage: SOURCE, enabledLanguages: ['pt', 'en', 'fr'] } });

describe('AI menu translation', () => {
  beforeEach(resetDatabase);

  it('fills only the missing languages and never touches the source or an existing translation', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    // The fixture dish already has a hand-written English name; it must survive untouched.
    const before = await db.productTranslation.findFirstOrThrow({ where: { productId: f.dish.id, language: 'en' } });
    expect(before.name).toBe('Test dish EN');

    const provider = new FakeProvider();
    const res = await translateMissing(f.ctx, {}, provider);
    expect(res.failed).toBe(0);
    expect(res.remaining).toBe(0);
    expect(res.created).toBeGreaterThan(0);

    const after = await db.productTranslation.findFirstOrThrow({ where: { productId: f.dish.id, language: 'en' } });
    expect(after.name).toBe('Test dish EN'); // untouched
    expect(after.status).toBe('REVIEWED');

    const fr = await db.productTranslation.findFirstOrThrow({ where: { productId: f.dish.id, language: 'fr' } });
    expect(fr.name).toBe('[fr] Test dish');
    expect(fr.status).toBe('MACHINE');

    // The source row is never rewritten, and no request ever asked for the source language.
    const src = await db.productTranslation.findFirstOrThrow({ where: { productId: f.dish.id, language: SOURCE } });
    expect(src.name).toBe('Test dish');
    expect(src.status).toBe('SOURCE');
    expect(provider.calls.every((c) => c.to !== SOURCE && c.from === SOURCE)).toBe(true);
  });

  it('keeps machine translations away from guests until they are approved', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    await translateMissing(f.ctx, {}, new FakeProvider());

    // A guest reading French still sees the restaurant's own text, not the machine output.
    let menu = await getPublicMenu(f.location.id, 'fr', 'TABLE');
    expect(menu.flatMap((c) => c.products).map((p) => p.name)).toContain('Test dish');
    expect(JSON.stringify(menu)).not.toContain('[fr]');

    const { approved } = await approveAllMachineTranslations(f.ctx, { confirmReviewed: true });
    expect(approved).toBeGreaterThan(0);
    menu = await getPublicMenu(f.location.id, 'fr', 'TABLE');
    expect(menu.flatMap((c) => c.products).map((p) => p.name)).toContain('[fr] Test dish');
  });

  it('refuses to approve everything without an explicit confirmation', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    await translateMissing(f.ctx, {}, new FakeProvider());
    await expect(approveAllMachineTranslations(f.ctx, { confirmReviewed: false })).rejects.toThrow(/confirm you checked/);
    expect(await db.productTranslation.count({ where: { status: 'MACHINE', product: { organizationId: f.org.id } } })).toBeGreaterThan(0);
  });

  it('never sends ingredients or allergens to the provider', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    await db.productTranslation.update({ where: { productId_language: { productId: f.dish.id, language: SOURCE } }, data: { ingredients: 'frango, amêndoa, canela' } });
    const provider = new FakeProvider();
    await translateMissing(f.ctx, {}, provider);
    const sent = JSON.stringify(provider.calls);
    expect(sent).not.toContain('amêndoa');
    expect(sent).not.toContain('frango');
    // And no ingredients are invented for the new language.
    const fr = await db.productTranslation.findFirstOrThrow({ where: { productId: f.dish.id, language: 'fr' } });
    expect(fr.ingredients).toBeNull();
  });

  it('reports what failed, keeps what succeeded, and retries only the rest on the next pass', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    const failing = await translateMissing(f.ctx, {}, new FakeProvider('fail'));
    expect(failing.created).toBe(0);
    expect(failing.failed).toBeGreaterThan(0);
    expect(failing.errors).toContain('Provider is down.');
    expect(failing.remaining).toBeGreaterThan(0);
    expect(await db.productTranslation.count({ where: { status: 'MACHINE', product: { organizationId: f.org.id } } })).toBe(0);

    // Provider recovers: the same call now finishes the job.
    const ok = await translateMissing(f.ctx, {}, new FakeProvider());
    expect(ok.created).toBe(failing.remaining);
    expect(ok.remaining).toBe(0);
  });

  it('refuses output that does not line up with what was asked for', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    for (const behaviour of ['short', 'empty'] as const) {
      const res = await translateMissing(f.ctx, {}, new FakeProvider(behaviour));
      expect(res.created).toBe(0);
      expect(res.errors.length).toBeGreaterThan(0);
    }
    // Nothing half-written reached the database.
    expect(await db.productTranslation.count({ where: { status: 'MACHINE', product: { organizationId: f.org.id } } })).toBe(0);
  });

  it('translates only an explicitly chosen dish when asked to', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    const res = await translateMissing(f.ctx, { only: [{ kind: 'product', id: f.tea.id }] }, new FakeProvider());
    expect(res.created).toBe(2); // tea × {en, fr}
    expect(await db.productTranslation.count({ where: { productId: f.dish.id, language: 'fr' } })).toBe(0);
  });

  it('makes no duplicate rows when the same run happens twice', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    await translateMissing(f.ctx, {}, new FakeProvider());
    const again = await translateMissing(f.ctx, {}, new FakeProvider());
    expect(again.created).toBe(0);
    const rows = await db.productTranslation.groupBy({ by: ['productId', 'language'], _count: true, where: { product: { organizationId: f.org.id } } });
    expect(rows.every((r) => r._count === 1)).toBe(true);
  });

  it('plans the work and prices it before anything is spent', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    const plan = await translationPlan(f.ctx);
    expect(plan.sourceLanguage).toBe(SOURCE);
    expect(plan.targets).toEqual(['en', 'fr']);
    expect(plan.cells).toBeGreaterThan(0);
    expect(plan.requests).toBe(2); // one request per target language for this small menu
    expect(plan.estimatedInputTokens).toBeGreaterThan(0);
    // No key configured in the test environment: the price is reported as unknown, not guessed.
    expect(plan.provider.configured).toBe(false);
    expect(plan.cost).toBeNull();

    await translateMissing(f.ctx, {}, new FakeProvider());
    expect((await translationPlan(f.ctx)).cells).toBe(0);
  });

  it('skips a dish with no source name instead of inventing one', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    await db.productTranslation.deleteMany({ where: { productId: f.tea.id } });
    const plan = await translationPlan(f.ctx);
    expect(plan.units.some((u) => u.id === f.tea.id)).toBe(false);
    await translateMissing(f.ctx, {}, new FakeProvider());
    expect(await db.productTranslation.count({ where: { productId: f.tea.id } })).toBe(0);
  });

  it('counts the work the same way the translations screen and the setup step do', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    const plan = await translationPlan(f.ctx);
    const grid = await getTranslationGrid(f.ctx);
    expect(grid.missing).toBe(plan.cells);

    await translateMissing(f.ctx, {}, new FakeProvider());
    const after = await getTranslationGrid(f.ctx);
    expect(after.missing).toBe(0);
    expect(after.unreviewed).toBeGreaterThan(0);

    // The setup step stays open while machine translations are unreviewed: guests are still
    // seeing the original text, so the step genuinely is not done.
    const step = () => getSetupProgress(f.org.id).then((p) => p.steps.find((s) => s.key === 'translations')!);
    expect((await step()).done).toBe(false);
    expect((await step()).missing.join(' ')).toMatch(/waiting for your approval/);

    await approveAllMachineTranslations(f.ctx, { confirmReviewed: true });
    await db.restaurantOrganization.update({ where: { id: f.org.id }, data: { onboardingData: { translationsReviewedAt: new Date().toISOString() } } });
    expect((await step()).done).toBe(true);
  });

  it('filters and paginates the editor so a long menu stays usable', async () => {
    const f = await createOrderingFixture();
    await pt(f);
    const all = await getTranslationGrid(f.ctx, { filter: 'all', perPage: 5 });
    expect(all.rows.length).toBeLessThanOrEqual(5);
    const missing = await getTranslationGrid(f.ctx, { filter: 'missing' });
    expect(missing.rows.length).toBeGreaterThan(0);

    await translateMissing(f.ctx, {}, new FakeProvider());
    expect((await getTranslationGrid(f.ctx, { filter: 'missing' })).rows).toHaveLength(0);
    const machine = await getTranslationGrid(f.ctx, { filter: 'machine' });
    expect(machine.rows.length).toBeGreaterThan(0);
    expect((await getTranslationGrid(f.ctx, { filter: 'machine', query: 'nothing matches this' })).rows).toHaveLength(0);
    expect((await getTranslationGrid(f.ctx, { filter: 'machine', query: 'Test tea' })).rows.length).toBeGreaterThan(0);
  });

  it('refuses to run when only one language is enabled', async () => {
    const f = await createOrderingFixture();
    await db.restaurantOrganization.update({ where: { id: f.org.id }, data: { sourceLanguage: 'pt', defaultLanguage: 'pt', enabledLanguages: ['pt'] } });
    await expect(translateMissing(f.ctx, {}, new FakeProvider())).rejects.toThrow(/Only one language/);
  });

  it('cannot reach another restaurant\'s menu', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    await pt(a);
    await pt(b);
    await translateMissing(a.ctx, {}, new FakeProvider());
    expect(await db.productTranslation.count({ where: { status: 'MACHINE', product: { organizationId: b.org.id } } })).toBe(0);
    // Naming B's dish explicitly from A's session changes nothing: the row is not A's.
    const res = await translateMissing(a.ctx, { only: [{ kind: 'product', id: b.dish.id }] }, new FakeProvider());
    expect(res.created).toBe(0);
    expect(await db.productTranslation.count({ where: { status: 'MACHINE', product: { organizationId: b.org.id } } })).toBe(0);
  });
});
