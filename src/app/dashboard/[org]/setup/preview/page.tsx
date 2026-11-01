import { ActionForm } from '@/components/forms/action-form';
import { PreviewSharePanel } from '@/components/dashboard/preview-share-panel';
import { PreviewStudio } from '@/components/dashboard/preview-studio';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { Card, Icon } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { displayUrl, restaurantPath } from '@/lib/restaurant-link';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { getRestaurantLink, previewPages } from '@/server/services/restaurant-link';
import { requireTenantPage } from '@/server/tenant';
import { markPreviewedAction } from '../actions';

const CHECKS = ['Names, prices and photos of your dishes', 'Sizes, extras and allergens (open a dish)', 'The cart total (ordering is off in previews)', 'Every language (Arabic reads right to left)'];

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const [o, firstTable, link] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { defaultLanguage: true, enabledLanguages: true } }),
    location ? db.restaurantTable.findFirst({ where: { locationId: location.id, isActive: true }, include: { qrTokens: { where: { isActive: true }, take: 1 } } }) : null,
    location ? getRestaurantLink(ctx, location.id) : null,
  ]);
  const pages = link ? await previewPages(ctx, link) : [];
  const nav = <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="preview" locationId={location?.id} />;
  if (!link) {
    return (
      <>
        {nav}
        <Card className="p-6 text-sm text-muted">Add a location first.</Card>
      </>
    );
  }
  const review = (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" data-testid="preview-checklist">
      <h2 className="text-sm font-semibold text-ink">What to check</h2>
      <ul className="space-y-1.5">
        {CHECKS.map((c) => (
          <li key={c} className="flex items-start gap-2 text-[13px] text-ink-2">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-success" />
            {c}
          </li>
        ))}
        {firstTable?.qrTokens[0] && (
          <li className="flex items-start gap-2 text-[13px] text-ink-2">
            <Icon name="qr" className="mt-0.5 size-4 shrink-0 text-muted" />
            <span>
              The table view:{' '}
              <a className="underline underline-offset-2" href={`/t/${firstTable.qrTokens[0].token}`} target="_blank" rel="noreferrer">
                open table {firstTable.label}
              </a>{' '}
              (ordering works after publishing)
            </span>
          </li>
        )}
      </ul>
      <ActionForm action={markPreviewedAction} submitLabel="I have reviewed the preview" successText="Recorded">
        <input type="hidden" name="org" value={ctx.org.slug} />
      </ActionForm>
    </div>
  );
  return (
    <>
      {nav}
      <PreviewStudio
        restaurantName={ctx.org.name}
        locationName={link.path !== restaurantPath(ctx.org.slug, '', false) ? link.location.name : undefined}
        published={link.location.isPublished}
        eyebrow="Setup · Preview your customer menu"
        pages={pages}
        languages={o.enabledLanguages.map((l) => ({ code: l, label: LANGUAGE_NATIVE_NAME[l] }))}
        defaultLang={o.defaultLanguage}
        displayHost={displayUrl(link.url).split('/')[0]}
        initialPage={typeof sp.page === 'string' ? sp.page : undefined}
        // The step bar above takes about 6 rem: keep the whole device visible on arrival.
        stageOffset="14rem"
        aside={
          <>
            {review}
            <PreviewSharePanel link={link} orgSlug={ctx.org.slug} canPublish />
          </>
        }
      />
    </>
  );
}
