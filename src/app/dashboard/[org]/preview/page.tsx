import { RestaurantLinkCard } from '@/components/dashboard/restaurant-link-card';
import { RestaurantPreview } from '@/components/dashboard/restaurant-preview';
import { Alert, Badge, PageHeader } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { displayUrl } from '@/lib/restaurant-link';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { getRestaurantLink, previewPages } from '@/server/services/restaurant-link';
import { requireTenantPage } from '@/server/tenant';

/** "Preview my restaurant": the real guest menu in a device frame, plus the public link to share. */
export default async function PreviewAndSharePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.view');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location yet.</Alert>;
  const [o, link] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { defaultLanguage: true, enabledLanguages: true } }),
    getRestaurantLink(ctx, location.id),
  ]);
  const pages = await previewPages(ctx, link);
  const host = displayUrl(link.url).split('/')[0];

  return (
    <>
      <PageHeader
        title="Preview your restaurant"
        meta={link.location.isPublished ? <Badge tone="success" dot>Published</Badge> : <Badge tone="warning" dot>Draft preview</Badge>}
        description={
          link.location.isPublished
            ? 'This is the live menu your guests see. Try every language and ordering option.'
            : 'Only your team can see this draft. Guests see it once you publish.'
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <RestaurantPreview pages={pages} languages={o.enabledLanguages.map((l) => ({ code: l, label: LANGUAGE_NATIVE_NAME[l] }))} defaultLang={o.defaultLanguage} displayHost={host} liveHref={link.location.isPublished ? link.path : undefined} />
        <div className="space-y-4 xl:sticky xl:top-20">
          <RestaurantLinkCard link={link} orgSlug={ctx.org.slug} canPublish={ctx.can('settings.manage')} showPreviewButton={false} />
        </div>
      </div>
    </>
  );
}
