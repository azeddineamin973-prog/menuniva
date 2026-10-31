import { ActionForm } from '@/components/forms/action-form';
import { RestaurantLinkCard } from '@/components/dashboard/restaurant-link-card';
import { RestaurantPreview } from '@/components/dashboard/restaurant-preview';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { Card, CardBody, CardHeader, Icon, PageHeader } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { displayUrl } from '@/lib/restaurant-link';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { getRestaurantLink, previewPages } from '@/server/services/restaurant-link';
import { requireTenantPage } from '@/server/tenant';
import { markPreviewedAction } from '../actions';

export default async function PreviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const [o, firstTable, link] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { defaultLanguage: true, enabledLanguages: true } }),
    location ? db.restaurantTable.findFirst({ where: { locationId: location.id, isActive: true }, include: { qrTokens: { where: { isActive: true }, take: 1 } } }) : null,
    location ? getRestaurantLink(ctx, location.id) : null,
  ]);
  const pages = link ? await previewPages(ctx, link) : [];
  const CHECKS = [
    'Switch languages with the selector above the preview (Arabic displays right-to-left).',
    'Open a dish and check sizes, extras and allergen information.',
    'Add items and open the cart to check the total. Ordering is off in previews.',
    'Look at pickup, delivery and reservation pages in the page selector.',
  ];
  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="preview" locationId={location?.id} />
      <PageHeader title="Preview your customer menu" description="This is exactly what guests will see on their phones. Check names, prices, photos and every language." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {link ? (
          <RestaurantPreview pages={pages} languages={o.enabledLanguages.map((l) => ({ code: l, label: LANGUAGE_NATIVE_NAME[l] }))} defaultLang={o.defaultLanguage} displayHost={displayUrl(link.url).split('/')[0]} />
        ) : (
          <Card className="p-6 text-sm text-muted">Add a location first.</Card>
        )}
        <div className="space-y-4 xl:sticky xl:top-20">
          <Card>
            <CardHeader title="What to check" icon="checkCircle" />
            <CardBody className="space-y-3 text-sm">
              <ul className="space-y-2">
                {CHECKS.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-ink-2">
                    <Icon name="check" className="mt-0.5 size-4 shrink-0 text-success" />
                    {c}
                  </li>
                ))}
                {firstTable?.qrTokens[0] && (
                  <li className="flex items-start gap-2 text-ink-2">
                    <Icon name="qr" className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span>
                      Table view:{' '}
                      <a className="underline underline-offset-2" href={`/t/${firstTable.qrTokens[0].token}`} target="_blank" rel="noreferrer">
                        open table {firstTable.label}
                      </a>{' '}
                      (ordering works only after publishing).
                    </span>
                  </li>
                )}
              </ul>
              <ActionForm action={markPreviewedAction} submitLabel="I have reviewed the preview" successText="Recorded">
                <input type="hidden" name="org" value={ctx.org.slug} />
              </ActionForm>
            </CardBody>
          </Card>
          {link && <RestaurantLinkCard link={link} orgSlug={ctx.org.slug} canPublish showPreviewButton={false} />}
        </div>
      </div>
    </>
  );
}
