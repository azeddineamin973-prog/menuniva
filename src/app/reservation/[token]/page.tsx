import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { fmt, LANGUAGE_TAG } from '@/i18n/config';
import { db } from '@/server/db';
import { trackReservation } from '@/server/services/reservations';
import { resolveGuestLanguage } from '@/server/services/storefront';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Private reservation status page (unguessable token). Shows the real status set by the restaurant. */
export default async function ReservationStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await trackReservation(token);
  if (!r) notFound();
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { slug: r.location.organization.slug }, include: { branding: true } });
  const lang = await resolveGuestLanguage(org, r.language);
  const m = getMessages(lang);
  const when = new Intl.DateTimeFormat(LANGUAGE_TAG[lang], { timeZone: r.location.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(r.startsAt);
  return (
    <StorefrontShell branding={org.branding} restaurantName={org.name} subtitle={m.reservation.trackTitle} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <div className="mx-auto max-w-md space-y-4 px-4 py-8 text-center">
        <p className="font-serif text-2xl">{when}</p>
        <p>{fmt(m.reservation.guests, { n: r.partySize })}</p>
        <p className="inline-block rounded-full bg-sf-primary px-4 py-1.5 text-sm font-medium text-white" data-testid="reservation-status" data-status={r.status}>
          {m.reservation.status[r.status]}
        </p>
        <p className="text-sm opacity-70">{m.reservation.keepPage}</p>
        {r.location.phone && <a href={`tel:${r.location.phone.replace(/\s/g, '')}`} className="block underline">{r.location.phone}</a>}
      </div>
    </StorefrontShell>
  );
}
