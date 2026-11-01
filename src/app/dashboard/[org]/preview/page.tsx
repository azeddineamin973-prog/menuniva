import { PreviewSharePanel } from '@/components/dashboard/preview-share-panel';
import { PreviewStudio } from '@/components/dashboard/preview-studio';
import { Alert } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { displayUrl, restaurantPath } from '@/lib/restaurant-link';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { getRestaurantLink, previewPages } from '@/server/services/restaurant-link';
import { requireTenantPage } from '@/server/tenant';

/** "Preview & share": the real guest pages in a device frame, with the public link beside them. */
export default async function PreviewAndSharePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'menu.view');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location yet.</Alert>;
  const [o, link] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { defaultLanguage: true, enabledLanguages: true } }),
    getRestaurantLink(ctx, location.id),
  ]);
  const pages = await previewPages(ctx, link);
  const multiLocation = link.path !== restaurantPath(ctx.org.slug, '', false);

  return (
    <PreviewStudio
      restaurantName={ctx.org.name}
      locationName={multiLocation ? link.location.name : undefined}
      published={link.location.isPublished}
      pages={pages}
      languages={o.enabledLanguages.map((l) => ({ code: l, label: LANGUAGE_NATIVE_NAME[l] }))}
      defaultLang={o.defaultLanguage}
      displayHost={displayUrl(link.url).split('/')[0]}
      initialPage={typeof sp.page === 'string' ? sp.page : undefined}
      aside={<PreviewSharePanel link={link} orgSlug={ctx.org.slug} canPublish={ctx.can('settings.manage')} />}
    />
  );
}
