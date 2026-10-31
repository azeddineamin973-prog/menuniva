import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, PageHeader, Select, Stat, statGrid } from '@/components/ui';
import { LANGUAGE_TAG } from '@/i18n/config';
import { centsToInputValue, formatCents } from '@/lib/money';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { externalPriceReview } from '@/server/services/price-bulk';
import { requireTenantPage } from '@/server/tenant';
import { applyExternalPricesAction, setPriceAction, setPricesInBulkAction, toggleSoldOutAction } from '../actions';

const PROVIDER_LABEL = { GLOVO: 'Glovo', UBER_EATS: 'Uber Eats', CSV: 'CSV', XLSX: 'Excel', PDF: 'PDF', IMAGE: 'Image', TEXT: 'Text', MANUAL: 'Manual' } as const;

/** Prices and availability: the bulk tools first, then the per-dish editor used during service. */
export default async function PricesPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ provider?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'menu.availability');
  const { categories, org: o } = await getMenuAdmin(ctx);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  const canPrice = ctx.can('menu.edit');
  const tag = LANGUAGE_TAG[o.defaultLanguage];
  const base = `/dashboard/${ctx.org.slug}`;
  const products = categories.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: pickName(c.translations, langs) })));
  const dineIn = (p: (typeof products)[number]) => p.prices.find((x) => x.channel === 'DINE_IN')?.amountCents;
  const unpriced = products.filter((p) => dineIn(p) === undefined);
  // Only the owner (menu.edit) may change prices, so the bulk tools are not even queried for others.
  const review = canPrice ? await externalPriceReview(ctx, sp.provider === 'UBER_EATS' ? 'UBER_EATS' : sp.provider === 'GLOVO' ? 'GLOVO' : null) : null;
  const fillable = review?.proposals.filter((p) => !p.replaces) ?? [];

  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="prices" />
      <PageHeader
        title="Prices & availability"
        description="Changes apply to new orders immediately. Orders already placed keep the price they were charged."
        actions={<ButtonLink href={`${base}/menu`} variant="secondary">Back to menu</ButtonLink>}
      />

      <div className={statGrid(3, 'mb-6')}>
        <Stat label="Dishes" value={products.length} />
        <Stat label="Without a dine-in price" value={<span data-testid="unpriced-count">{unpriced.length}</span>} hint={unpriced.length > 0 ? 'These cannot be made visible to guests' : 'All dishes are priced'} />
        <Stat label="Sold out right now" value={products.filter((p) => p.soldOut).length} />
      </div>

      {review && review.providers.length > 0 && review.provider && (
        <Card className="mb-6" data-testid="external-prices">
          <CardHeader
            title={`Use ${PROVIDER_LABEL[review.provider]} prices for dine-in`}
            description={`Copies the exact amounts captured when you imported your ${PROVIDER_LABEL[review.provider]} menu. Your ${PROVIDER_LABEL[review.provider]} reference prices are kept, not moved.`}
            action={
              review.providers.length > 1 ? (
                <div className="flex gap-1.5">
                  {review.providers.map((p) => (
                    <ButtonLink key={p.provider} href={`${base}/menu/quick?provider=${p.provider}`} size="sm" variant={p.provider === review.provider ? 'dark' : 'secondary'}>
                      {PROVIDER_LABEL[p.provider]} ({p.missingDineIn})
                    </ButtonLink>
                  ))}
                </div>
              ) : (
                <Badge tone="lime">{fillable.length} can be filled</Badge>
              )
            }
          />
          <CardBody className="space-y-4">
            <Alert tone="info">
              A delivery-platform price usually includes that platform&apos;s commission, so it is often higher than what you charge at your own table. Check the amounts below before applying them — you can
              edit any of them afterwards.
            </Alert>
            {review.currencyMismatches.length > 0 && (
              <Alert tone="warning" title="Skipped: different currency">
                {review.currencyMismatches.length} imported prices are not in {review.restaurantCurrency} and are left alone. MenuNiva does not convert currencies.
              </Alert>
            )}
            {review.proposals.length === 0 ? (
              <Alert tone="success">Every imported dish already has a dine-in price.</Alert>
            ) : (
              <ActionForm action={applyExternalPricesAction} submitLabel={`Apply to ${fillable.length || review.proposals.length} dishes`} submitVariant="dark" successText="Prices applied" testId="apply-external-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="provider" value={review.provider} />
                <div className="max-h-80 overflow-auto rounded-xl border border-line">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-start">
                      <tr>
                        <th className="w-10 p-2" aria-label="Include" />
                        <th className="p-2 text-start font-medium">Dish</th>
                        <th className="p-2 text-start font-medium">Now</th>
                        <th className="p-2 text-start font-medium">{PROVIDER_LABEL[review.provider]}</th>
                        <th className="p-2 text-start font-medium">Sizes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {review.proposals.map((p) => {
                        const sizes = p.variants.filter((v) => v.proposedDeltaCents !== null && v.proposedDeltaCents !== v.currentDeltaCents);
                        return (
                          <tr key={p.productId} data-testid="proposal-row">
                            <td className="p-2 align-top">
                              <input type="checkbox" name="productIds" value={p.productId} defaultChecked={!p.replaces} aria-label={`Include ${p.name}`} className="size-4 accent-[#7ac70c] pointer-coarse:size-5" />
                            </td>
                            <td className="p-2 align-top">
                              <Link href={`${base}/menu/products/${p.productId}`} className="font-medium underline-offset-2 hover:underline">
                                {p.name}
                              </Link>
                              <span className="block text-xs text-muted">{p.categoryName}</span>
                            </td>
                            <td className="p-2 align-top tabular-nums">
                              {p.currentDineInCents === null ? <span className="text-danger">none</span> : formatCents(p.currentDineInCents, tag)}
                            </td>
                            <td className="p-2 align-top font-semibold tabular-nums" data-testid="proposed-price">
                              {formatCents(p.externalCents, tag)}
                            </td>
                            <td className="p-2 align-top text-xs text-muted">
                              {p.variants.length === 0 ? '—' : sizes.length > 0 ? sizes.map((v) => `${v.name} ${v.proposedDeltaCents! >= 0 ? '+' : ''}${formatCents(v.proposedDeltaCents!, tag)}`).join(', ') : `${p.variants.length} unchanged`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Checkbox name="applyVariants" defaultChecked label="Also restore the size price differences" description="Recovered from the original import, where a large portion cost more than a small one. Sizes you priced yourself are left alone." />
                <Checkbox name="overwriteExisting" label="Replace prices I already set" description="Off by default, so a price you typed is never silently overwritten." />
                <Checkbox name="makeVisible" label="Make these dishes visible to guests" description="Optional. Pricing a dish does not publish it; tick this to also take the drafts live." />
                <Checkbox name="confirm" label="I reviewed these prices and want to use them as my dine-in prices" description="Required." />
              </ActionForm>
            )}
          </CardBody>
        </Card>
      )}

      {canPrice && unpriced.length > 0 && (
        <Card className="mb-6" data-testid="bulk-price">
          <CardHeader title="Set one price for several dishes" description="Useful when a whole group costs the same, for example every tea at €2,50." />
          <CardBody>
            <ActionForm action={setPricesInBulkAction} submitLabel="Set price for selected" successText="Prices set" testId="bulk-price-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <div className="grid items-end gap-3 sm:grid-cols-[160px_160px_1fr]">
                <Field label="Channel" htmlFor="bulk-channel">
                  <Select id="bulk-channel" name="channel" defaultValue="DINE_IN">
                    <option value="DINE_IN">Dine-in</option>
                    <option value="TAKEAWAY">Takeaway</option>
                    <option value="DELIVERY">Delivery</option>
                  </Select>
                </Field>
                <Field label="Price €" htmlFor="bulk-price-input">
                  <Input id="bulk-price-input" name="price" inputMode="decimal" placeholder="2,50" required />
                </Field>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {unpriced.map((p) => (
                  <label key={p.id} className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" name="productIds" value={p.id} className="size-4 shrink-0 accent-[#7ac70c] pointer-coarse:size-5" />
                      {pickName(p.translations, langs)}
                    </span>
                    <span className="text-xs text-muted">{p.categoryName}</span>
                  </label>
                ))}
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="No dishes yet"
          description="Import your menu from your Glovo link or a file, or add dishes by hand."
          action={<ButtonLink href={`${base}/import`}>Open Import Studio</ButtonLink>}
        />
      ) : (
        <Card>
          <CardHeader title="Every dish" description="Change one price, or mark a dish sold out during service." />
          <ul className="divide-y divide-line">
            {products.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-3" data-testid="price-row">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{pickName(p.translations, langs)}</p>
                    <p className="text-xs text-muted">
                      {p.categoryName}
                      {dineIn(p) === undefined && <span className="ms-2 text-danger">No dine-in price</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.soldOut && <Badge tone="danger">Sold out</Badge>}
                    <InlineAction
                      action={toggleSoldOutAction}
                      fields={{ org: ctx.org.slug, productId: p.id, soldOut: String(!p.soldOut) }}
                      label={p.soldOut ? 'Available' : 'Sold out'}
                      variant={p.soldOut ? 'primary' : 'secondary'}
                      size="md"
                    />
                  </div>
                </div>
                {canPrice && (
                  <ActionForm action={setPriceAction} submitLabel="Save" submitVariant="secondary" className="flex items-center gap-2 space-y-0" successText="Saved">
                    <input type="hidden" name="org" value={ctx.org.slug} />
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="channel" value="DINE_IN" />
                    <label className="shrink-0 text-xs whitespace-nowrap text-muted" htmlFor={`q-${p.id}`}>
                      Dine-in €
                    </label>
                    <Input id={`q-${p.id}`} name="price" inputMode="decimal" className="w-28" defaultValue={centsToInputValue(dineIn(p))} />
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
