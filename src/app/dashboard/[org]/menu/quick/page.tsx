import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { centsToInputValue } from '@/lib/money';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { requireTenantPage } from '@/server/tenant';
import { setPriceAction, toggleSoldOutAction } from '../actions';

/** Mobile-first screen to change prices and availability quickly during service. */
export default async function QuickEditPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.availability');
  const { categories, org: o } = await getMenuAdmin(ctx);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  const canPrice = ctx.can('menu.edit');
  const products = categories.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: pickName(c.translations, langs) })));
  return (
    <>
      <PageHeader title="Quick prices & sold out" description="Changes apply to new orders immediately. Orders already placed keep their original prices." />
      {products.length === 0 ? (
        <EmptyState title="No dishes yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {products.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{pickName(p.translations, langs)}</p>
                    <p className="text-xs text-muted">{p.categoryName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.soldOut && <Badge tone="danger">Sold out</Badge>}
                    <InlineAction action={toggleSoldOutAction} fields={{ org: ctx.org.slug, productId: p.id, soldOut: String(!p.soldOut) }} label={p.soldOut ? 'Available' : 'Sold out'} variant={p.soldOut ? 'primary' : 'secondary'} size="md" />
                  </div>
                </div>
                {canPrice && (
                  <ActionForm action={setPriceAction} submitLabel="Save" submitVariant="secondary" className="flex items-center gap-2 space-y-0" successText="Saved">
                    <input type="hidden" name="org" value={ctx.org.slug} />
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="channel" value="DINE_IN" />
                    <label className="text-xs text-muted" htmlFor={`q-${p.id}`}>Dine-in €</label>
                    <Input id={`q-${p.id}`} name="price" inputMode="decimal" className="w-28" defaultValue={centsToInputValue(p.prices.find((x) => x.channel === 'DINE_IN')?.amountCents)} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
