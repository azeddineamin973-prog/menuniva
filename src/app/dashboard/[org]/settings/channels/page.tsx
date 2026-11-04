import { ActionForm, FieldError } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { unopenedTableOrders } from '@/server/services/table-access';
import { saveChannelSettingsAction } from '../actions';
import { SettingsTabs } from '../tabs';
import { fmt } from '@/i18n/config';
import { getDashText } from '@/i18n/dash';
import { getUiText } from '@/i18n/ui';

const POLICIES = ['SESSION_PIN', 'SESSION', 'OPEN'] as const;

export default async function ChannelsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const t = getDashText(ctx.user.preferredLanguage).channels;
  const ui = getUiText(ctx.user.preferredLanguage);
  const location = await currentLocation(ctx);
  const review = location ? await db.reviewSettings.findUnique({ where: { locationId: location.id } }) : null;
  const base = `/dashboard/${ctx.org.slug}`;
  if (!location) return <Alert tone="warning">{t.noLocation}</Alert>;
  const exposure = await unopenedTableOrders(ctx, location.id);
  const link = (name: keyof typeof location, label: string, hint: string) => (
    <Field label={label} htmlFor={String(name)} hint={hint} optionalLabel={ui.optional}>
      <Input id={String(name)} name={String(name)} type="url" placeholder="https://" defaultValue={(location[name] as string | null) ?? ''} />
      <FieldError name={String(name)} />
    </Field>
  );
  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="channels" locationId={location.id} />
      <PageHeader title={t.title} description={fmt(t.settingsFor, { name: location.name })} />
      <SettingsTabs base={base} active="channels" />
      <ActionForm action={saveChannelSettingsAction} testId="channels-form">
        <input type="hidden" name="org" value={ctx.org.slug} />
        <input type="hidden" name="locationId" value={location.id} />
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title={t.menuniva} description={t.menunivaDesc} />
            <CardBody className="space-y-4">
              <Checkbox name="tableOrderingEnabled" label={t.table} description={t.tableDesc} defaultChecked={location.tableOrderingEnabled} />
              <Checkbox name="takeawayEnabled" label={t.takeaway} description={t.takeawayDesc} defaultChecked={location.takeawayEnabled} />
              <Checkbox name="deliveryEnabled" label={t.delivery} description={t.deliveryDesc} defaultChecked={location.deliveryEnabled} />
              <fieldset className="space-y-2 rounded-xl border border-line p-3" data-testid="table-policy">
                <legend className="px-1 text-sm font-semibold text-ink">{t.whoCanOrder}</legend>
                {POLICIES.map((value) => ({ value, label: t.policies[value], description: t.policyDesc[value] })).map((p) => (
                  <label key={p.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-surface-2">
                    <input type="radio" name="tableOrderingPolicy" value={p.value} defaultChecked={location.tableOrderingPolicy === p.value} className="mt-1 size-4 shrink-0 accent-[#7ac70c]" data-testid={`policy-${p.value}`} />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {p.label}
                        {p.value === 'SESSION_PIN' && <span className="ms-2 rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink">{t.recommended}</span>}
                      </span>
                      <span className="block text-xs text-muted">{p.description}</span>
                    </span>
                  </label>
                ))}
                {location.tableOrderingPolicy === 'OPEN' && (
                  <p className="rounded-lg bg-warning/10 p-2 text-xs text-ink-2" data-testid="policy-exposure">
                    {fmt(t.exposure, { orders: exposure.orders === 1 ? t.exposureOrders1 : fmt(t.exposureOrdersN, { n: exposure.orders }), tables: exposure.sessions === 1 ? t.exposureTables1 : fmt(t.exposureTablesN, { n: exposure.sessions }) })}
                  </p>
                )}
                <Field label={t.cap} htmlFor="tablePendingOrderCap" hint={t.capHint}>
                  <Input id="tablePendingOrderCap" name="tablePendingOrderCap" type="number" min={1} max={50} defaultValue={location.tablePendingOrderCap} className="max-w-28" />
                  <FieldError name="tablePendingOrderCap" />
                </Field>
              </fieldset>
              <Checkbox name="reservationsEnabled" label={t.reservations} description={t.reservationsDesc} defaultChecked={location.reservationsEnabled} />
              <Checkbox name="whatsappOrderingEnabled" label={t.whatsapp} description={t.whatsappDesc} defaultChecked={location.whatsappOrderingEnabled} />
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                <Checkbox name="orderingPaused" label={t.pause} description={t.pauseDesc} defaultChecked={location.orderingPaused} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t.links} description={t.linksDesc} />
            <CardBody className="space-y-4">
              {link('glovoUrl', t.glovo, t.glovoHint)}
              {link('uberEatsUrl', t.uber, t.uberHint)}
              {link('websiteUrl', t.website, '')}
              {link('instagramUrl', 'Instagram', '')}
              {link('facebookUrl', 'Facebook', '')}
              {link('tiktokUrl', 'TikTok', '')}
              <Field label={t.google} htmlFor="googleReviewUrl" optionalLabel={ui.optional} hint={t.googleHint}>
                <Input id="googleReviewUrl" name="googleReviewUrl" type="url" placeholder="https://g.page/r/…" defaultValue={review?.googleReviewUrl ?? ''} />
                <FieldError name="googleReviewUrl" />
              </Field>
            </CardBody>
          </Card>
        </div>
      </ActionForm>
    </>
  );
}
