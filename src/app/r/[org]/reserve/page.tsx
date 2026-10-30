import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { resolveGuestLanguage } from '@/server/services/storefront';
import { ReserveForm } from './reserve-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

export default async function ReservePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ l?: string; lang?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const org = await db.restaurantOrganization.findUnique({ where: { slug }, include: { branding: true } });
  if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') notFound();
  const location = await db.restaurantLocation.findFirst({ where: { organizationId: org.id, isPublished: true, reservationsEnabled: true, ...(sp.l ? { slug: sp.l } : {}) }, include: { reservationSettings: true }, orderBy: { createdAt: 'asc' } });
  if (!location) notFound();
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const p = zonedParts(new Date(), location.timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={m.reservation.title} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <div className="mx-auto max-w-lg px-4 py-6">
        <h2 className="mb-4 font-serif text-2xl">{m.reservation.title}</h2>
        <ReserveForm org={org.slug} l={sp.l} lang={lang} today={today} maxParty={location.reservationSettings?.maxPartySize ?? 8} m={{ reservation: m.reservation, validation: m.validation, common: m.common }} />
      </div>
    </StorefrontShell>
  );
}
