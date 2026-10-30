import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { upsellRulesAdmin } from '@/server/services/upsell';
import { requireTenantPage } from '@/server/tenant';
import { createUpsellRuleAction, deleteUpsellRuleAction, toggleUpsellRuleAction, upsellEnabledAction } from './actions';

export default async function UpsellPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const [{ categories, org: o }, rules, settings] = await Promise.all([getMenuAdmin(ctx), upsellRulesAdmin(ctx), db.restaurantSettings.findUnique({ where: { organizationId: ctx.org.id } })]);
  const langs = [o.sourceLanguage, o.defaultLanguage, ...o.enabledLanguages];
  const enabled = settings?.upsellEnabled ?? true;
  const productName = new Map<string, string>();
  const categoryName = new Map<string, string>();
  for (const c of categories) {
    categoryName.set(c.id, pickName(c.translations, langs) ?? '—');
    for (const p of c.products) productName.set(p.id, pickName(p.translations, langs) ?? '—');
  }
  const products = categories.flatMap((c) => c.products.map((p) => ({ id: p.id, name: productName.get(p.id)!, category: categoryName.get(c.id)! })));
  return (
    <>
      <PageHeader
        title="Cart suggestions"
        description="When a guest's cart contains a dish (or anything from a category), suggest another dish. Guests always choose; nothing is added for them. Sold-out or unavailable dishes are never suggested."
        actions={
          <InlineAction action={upsellEnabledAction} fields={{ org: ctx.org.slug, enabled: String(!enabled) }} label={enabled ? 'Turn suggestions off' : 'Turn suggestions on'} variant={enabled ? 'secondary' : 'primary'} testId="upsell-toggle-all" />
        }
      />
      <p className="mb-4 text-sm"><Link className="underline" href={`/dashboard/${ctx.org.slug}/menu`}>← Menu</Link></p>
      {!enabled && <div className="mb-4"><Alert tone="warning">Suggestions are switched off. Guests see none.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Suggestions" description="Shown / accepted counts are for the last 30 days." />
          {rules.length === 0 ? (
            <CardBody><EmptyState title="No suggestions yet" description="Example: when the cart has a tagine, suggest mint tea." /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-3" data-testid="upsell-rule">
                  <span className="text-sm">
                    {r.triggerProductId ? <strong>{productName.get(r.triggerProductId) ?? 'Removed dish'}</strong> : <>any of <strong>{categoryName.get(r.triggerCategoryId ?? '') ?? 'Removed category'}</strong></>}
                    {' → '}
                    <strong>{productName.get(r.suggestedProductId) ?? 'Removed dish'}</strong>
                  </span>
                  {!r.isActive && <Badge tone="neutral">paused</Badge>}
                  {r.priority > 0 && <Badge tone="dark">priority {r.priority}</Badge>}
                  <span className="ms-auto text-xs text-muted tabular-nums" data-testid="upsell-counts">{r.shown} shown · {r.accepted} accepted</span>
                  <InlineAction action={toggleUpsellRuleAction} fields={{ org: ctx.org.slug, ruleId: r.id, active: String(!r.isActive) }} label={r.isActive ? 'Pause' : 'Resume'} variant="ghost" />
                  <InlineAction action={deleteUpsellRuleAction} fields={{ org: ctx.org.slug, ruleId: r.id }} label="Delete" variant="danger" confirm="Delete this suggestion?" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Add a suggestion" />
          <CardBody>
            {products.length < 2 ? (
              <p className="text-sm text-muted">Add at least two dishes to your menu first.</p>
            ) : (
              <ActionForm action={createUpsellRuleAction} submitLabel="Add suggestion" testId="upsell-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <Field label="When the cart contains" htmlFor="up-trigger">
                  <Select id="up-trigger" name="trigger" data-testid="upsell-trigger">
                    <optgroup label="Dish">
                      {products.map((p) => <option key={p.id} value={`product:${p.id}`}>{p.name} ({p.category})</option>)}
                    </optgroup>
                    <optgroup label="Anything from category">
                      {categories.map((c) => <option key={c.id} value={`category:${c.id}`}>{categoryName.get(c.id)}</option>)}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="Suggest" htmlFor="up-suggest">
                  <Select id="up-suggest" name="suggestedProductId" data-testid="upsell-suggested">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
                  </Select>
                </Field>
                <Field label="Priority" htmlFor="up-priority" hint="Higher shows first. At most two suggestions appear at once.">
                  <Input id="up-priority" name="priority" type="number" min={0} max={100} defaultValue={0} />
                </Field>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
