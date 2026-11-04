import type { Metadata } from 'next';
import { EveryLanguage, EveryOrder, Facts, Kitchen, OneMenu } from '@/components/landing/chapters';
import { Faq, type FaqItem } from '@/components/landing/faq';
import { AroundTheMeal, HowItWorks } from '@/components/landing/features';
import { FinalCta, SiteFooter } from '@/components/landing/footer';
import { SiteHeader } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { toPlanCards, type PlanRow } from '@/components/landing/plans';
import { Pricing } from '@/components/landing/pricing';
import type { Cta } from '@/components/landing/ui';
import { getCurrentUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { DEFAULT_PLANS } from '@/server/services/plans';
import { CONFIG_DEFAULTS, getPlatformConfig, type PlatformConfigValues } from '@/server/services/platform-config';

export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'One menu for QR table ordering, takeaway, your own delivery and WhatsApp orders, with kitchen and café displays, reservations and private guest feedback, in five languages. Made for restaurants in Portugal and Spain.';

export const metadata: Metadata = {
  description: DESCRIPTION,
  alternates: { canonical: `${env.APP_BASE_URL}/` },
  openGraph: { type: 'website', siteName: 'MenuNiva', url: `${env.APP_BASE_URL}/`, title: 'MenuNiva — One Menu. Every Order. Every Language.', description: DESCRIPTION },
};

/**
 * Active plans as configured in Super Admin. Before any plan exists the defaults are shown (they are
 * what the platform creates first); if the database cannot be read, the plan cards are left out.
 */
async function loadPlans(): Promise<PlanRow[] | null> {
  try {
    const rows = await db.subscriptionPlan.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, description: true, monthlyPriceCents: true, currency: true, limits: true, features: true, isActive: true },
    });
    if (rows.length === 0) return DEFAULT_PLANS.map((p) => ({ ...p, currency: 'EUR', features: [...p.features] }));
    return rows.filter((p) => p.isActive);
  } catch {
    return null;
  }
}

/** The one main action: open the dashboard, start the trial, or (registrations paused) get in touch. */
function mainCta(signedIn: boolean, config: PlatformConfigValues): Cta {
  if (signedIn) return { href: '/dashboard', label: 'Open your dashboard', short: 'Dashboard' };
  if (config.signupsOpen) return config.defaultTrialDays > 0 ? { href: '/signup', label: 'Start free trial', short: 'Free trial' } : { href: '/signup', label: 'Create your account', short: 'Sign up' };
  if (config.supportEmail) return { href: `mailto:${config.supportEmail}`, label: 'Contact us', short: 'Contact' };
  return { href: '/login', label: 'Sign in', short: 'Sign in' };
}

function faqItems(config: PlatformConfigValues, trialDays: number, manualBilling: boolean): FaqItem[] {
  const items: FaqItem[] = [
    { q: 'Do guests need an app or an account?', a: 'No. Guests scan the QR code on their table and order in the browser. There is no app to install and no customer login.' },
    {
      q: 'How do guests pay?',
      a: 'At your restaurant: at the counter, to the waiter, or in cash or by card on delivery. MenuNiva records each payment and lets you split bills. Online payment needs a separate payment provider.',
    },
    {
      q: 'Does MenuNiva take a commission on orders?',
      a: 'No. MenuNiva is a monthly subscription. There is no commission on orders through your own MenuNiva channels: table QR, takeaway, delivery and WhatsApp.',
    },
    {
      q: 'Which languages can guests use?',
      a: (
        <>
          Português (Portugal), English, Français,{' '}
          <bdi lang="ar" dir="rtl">
            العربية
          </bdi>{' '}
          and Español, with Arabic shown right-to-left. Translations stay hidden from guests until you have reviewed them; until then guests see your original text.
        </>
      ),
    },
    {
      q: 'Can I import my current menu?',
      a: 'Yes. Paste a Glovo store link, or upload an Uber Eats export, an Excel or CSV file, a PDF or plain text. You review every dish, price and allergen before anything is published.',
    },
    {
      q: 'What equipment do I need?',
      a: 'A phone, tablet or computer with a web browser. Kitchen and café displays run in the browser on any tablet, laptop or TV, and tickets print from the browser or as PDF.',
    },
    {
      q: 'Can I keep selling on Glovo and Uber Eats?',
      a: 'Yes. Import your menu from them and link to your store pages from your MenuNiva page. Orders placed on those platforms stay on those platforms.',
    },
    {
      q: 'Are MenuNiva receipts invoices?',
      a: 'No. MenuNiva receipts are not legal invoices. Certified invoicing in Portugal and Spain needs a certified invoicing provider.',
    },
    {
      q: 'How is guest data handled?',
      a: 'Each restaurant chooses how long guest contact details are kept, and older details are erased automatically. A guest’s data can be exported or erased on request.',
    },
  ];
  if (trialDays > 0) {
    const during = config.trialIncludesAllModules ? 'Every feature is available during the trial. ' : '';
    const billing = manualBilling ? ' Nothing is charged automatically: billing is arranged with MenuNiva directly.' : '';
    items.push({ q: `What happens after the ${trialDays}-day trial?`, a: `${during}When the trial ends, your restaurant keeps the features of its plan.${billing}` });
  }
  return items;
}

export default async function HomePage() {
  const [planRows, config, user] = await Promise.all([loadPlans(), getPlatformConfig().catch(() => CONFIG_DEFAULTS), getCurrentUser().catch(() => null)]);
  const signedIn = user !== null;
  const cta = mainCta(signedIn, config);
  // Trial wording only where it is true: registrations open and a trial length set.
  const trialDays = config.signupsOpen ? config.defaultTrialDays : 0;
  const manualBilling = env.BILLING_PROVIDER === 'manual';

  const perks = [
    ...(trialDays > 0 && !signedIn ? [`${trialDays}-day free trial`] : []),
    ...(manualBilling && config.signupsOpen && !signedIn ? ['No card required'] : []),
    '0% commission on your own channels',
  ];
  const trialNote =
    trialDays > 0 && !signedIn
      ? [`${trialDays}-day free trial`, config.trialIncludesAllModules ? 'every feature included' : null, manualBilling ? 'no card required' : null].filter(Boolean).join(' · ')
      : null;
  const signIn = { href: '/login', label: 'Sign in' };
  const showSignIn = !signedIn && cta.href !== '/login';
  const account = signedIn
    ? [{ href: '/dashboard', label: 'Dashboard' }, { href: '/account', label: 'My account' }]
    : [...(config.signupsOpen ? [{ href: '/signup', label: trialDays > 0 ? 'Start free trial' : 'Create account' }] : []), { href: '/login', label: 'Sign in (owners and staff)' }];

  return (
    // English page: left-to-right even when the visitor chose Arabic elsewhere (the cookie sets
    // dir="rtl" on <html>). `relative` makes the clip also contain absolutely positioned children.
    <div dir="ltr" lang="en" className="mn-landing relative min-h-dvh overflow-x-clip bg-bg text-ink">
      <a href="#main" className="sr-only z-50 rounded-lg bg-graphite px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:start-4 focus:top-3">
        Skip to content
      </a>
      <SiteHeader cta={cta} showSignIn={showSignIn} />
      <main id="main">
        <Hero cta={cta} perks={perks} />
        <Facts />
        <OneMenu />
        <EveryOrder />
        <Kitchen />
        <EveryLanguage />
        <AroundTheMeal />
        <HowItWorks cta={cta} />
        <Pricing plans={planRows && toPlanCards(planRows)} cta={cta} trialNote={trialNote} />
        <Faq items={faqItems(config, trialDays, manualBilling)} supportEmail={config.supportEmail} />
        <FinalCta cta={cta} perks={perks} secondary={showSignIn ? signIn : null} />
      </main>
      <SiteFooter account={account} supportEmail={config.supportEmail} />
    </div>
  );
}
