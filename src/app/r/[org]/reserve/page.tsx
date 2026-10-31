import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { canPreviewOrg, resolveGuestLanguage } from '@/server/services/storefront';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { ReserveForm } from './reserve-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

export default async function ReservePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ l?: string; lang?: string; preview?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const org = await db.restaurantOrganization.findUnique({ where: { slug }, include: { branding: true } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') notFound();
  // Members may preview the form before publishing; it cannot be submitted then.
  const preview = await canPreviewOrg(org.id, sp.preview === '1');
  const location = await db.restaurantLocation.findFirst({ where: { organizationId: org.id, ...(preview ? {} : { isPublished: true }), reservationsEnabled: true, ...(sp.l ? { slug: sp.l } : {}) }, include: { reservationSettings: true }, orderBy: { createdAt: 'asc' } });
  if (!location || !(await orgModules(org.id)).has('reservations')) notFound();
  const isPreview = preview && !location.isPublished;
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const p = zonedParts(new Date(), location.timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={m.reservation.title} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      {isPreview && <PreviewBanner />}
      <div className="mx-auto max-w-lg px-4 py-6">
        <h2 className="mb-4 font-serif text-2xl">{m.reservation.title}</h2>
        {isPreview && (
          <p className="mb-4 rounded-2xl border border-sf-accent/40 bg-sf-card/70 p-3 text-sm" role="status">
            {m.customer.previewOrdering}
          </p>
        )}
        <fieldset disabled={isPreview} className="min-w-0 disabled:opacity-60">
          <ReserveForm org={org.slug} l={sp.l} lang={lang} today={today} maxParty={location.reservationSettings?.maxPartySize ?? 8} m={{ reservation: m.reservation, validation: m.validation, common: m.common }} />
        </fieldset>
      </div>
    </StorefrontShell>
  );
}
