import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';
import { Card, CardBody } from '@/components/ui';
import { fmt } from '@/i18n/config';
import { getDashText } from '@/i18n/dash';
import { getCurrentUser } from '@/server/auth/session';
import { getPlatformConfig } from '@/server/services/platform-config';
import { RegisterRestaurantForm } from './register-form';

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return { title: getDashText(user?.preferredLanguage ?? 'en').onboarding.metaTitle, robots: { index: false } };
}

export default async function NewRestaurantPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/onboarding/new');
  const config = await getPlatformConfig();
  const lang = user.preferredLanguage;
  const d = getDashText(lang);
  const t = d.onboarding;
  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Logo />
        <LanguageCookieSwitcher current={lang} saveToAccount label={d.layout.language} />
      </div>
      <p className="text-sm font-medium text-muted">{t.step}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.intro}</p>
      <Card className="mt-6">
        <CardBody>
          {config.signupsOpen ? (
            <RegisterRestaurantForm t={t} />
          ) : (
            <p className="text-sm" data-testid="signups-closed">
              {t.paused}{' '}
              {config.supportEmail ? (
                <a className="underline" href={`mailto:${config.supportEmail}`}>{fmt(t.contact, { email: config.supportEmail })}</a>
              ) : (
                t.contactSupport
              )}
            </p>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
