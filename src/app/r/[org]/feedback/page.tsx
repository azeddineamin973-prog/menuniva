import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorefrontShell } from '@/components/storefront/shell';
import { getMessages } from '@/i18n';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { feedbackLocation, googleReviewLinkFor } from '@/server/services/feedback';
import { resolveGuestLanguage } from '@/server/services/storefront';
import { FeedbackForm } from './feedback-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

/** Private feedback + the restaurant's Google review link, shown the same way to every guest. */
export default async function FeedbackPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ l?: string; o?: string; lang?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const target = await feedbackLocation(slug, sp.l, sp.o);
  if (!target) notFound();
  const { org, location } = target;
  if (!(await orgModules(org.id)).has('feedback')) notFound();
  const branding = await db.restaurantBranding.findUnique({ where: { organizationId: org.id } });
  const lang = await resolveGuestLanguage(org, sp.lang);
  const m = getMessages(lang);
  const google = await googleReviewLinkFor(location.id);
  const enabled = org.settings?.feedbackEnabled ?? true;
  return (
    <StorefrontShell branding={branding} restaurantName={org.name} subtitle={m.customer.leaveFeedback} lang={lang} languages={org.enabledLanguages} compactHeader poweredBy={m.common.poweredBy}>
      <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
        {enabled && (
          <>
            <div className="text-center">
              <h2 className="font-serif text-2xl">{m.feedback.title}</h2>
              <p className="mt-1 text-sm opacity-70">{m.feedback.subtitle}</p>
            </div>
            <FeedbackForm org={org.slug} l={sp.l} orderToken={sp.o} lang={lang} m={{ feedback: m.feedback, common: m.common, validation: m.validation }} />
          </>
        )}
        {google && (
          <div className="rounded-2xl bg-white/80 p-4 text-center ring-1 ring-black/5" data-testid="google-review">
            <p className="text-sm">{m.feedback.googleCta}</p>
            <a href={google} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block rounded-xl px-4 py-2 font-medium ring-1 ring-black/10" data-testid="google-review-link">
              {m.feedback.googleButton} ↗
            </a>
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}
