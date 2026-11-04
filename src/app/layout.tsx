import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { UiTextProvider } from '@/components/ui-text';
import { dirOf, isLanguage, LANG_COOKIE, LANGUAGE_TAG } from '@/i18n/config';
import { getUiText } from '@/i18n/ui';
import { env } from '@/server/env';
import { getCurrentUser, SESSION_COOKIE } from '@/server/auth/session';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MenuNiva — One Menu. Every Order. Every Language.', template: '%s · MenuNiva' },
  description:
    'MenuNiva is a multi-language restaurant platform: QR table ordering, takeaway, restaurant delivery, kitchen displays, reservations and private feedback.',
  applicationName: 'MenuNiva',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1113' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const langCookie = jar.get(LANG_COOKIE)?.value;
  // Signed in: the account's language (also for sessions started before the cookie existed);
  // otherwise the visitor's choice. getCurrentUser returns at once when there is no session cookie.
  const user = jar.has(SESSION_COOKIE) ? await getCurrentUser() : null;
  const lang = user?.preferredLanguage ?? (isLanguage(langCookie) ? langCookie : 'en');
  const dark = jar.get('mn_theme')?.value === 'dark';
  return (
    <html lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)} className={dark ? 'dark' : undefined} suppressHydrationWarning>
      <body className="min-h-dvh">
        {env.APP_ENV === 'demo' && (
          <div className="bg-warning px-4 py-1 text-center text-xs font-semibold text-white" data-testid="demo-environment">
            MenuNiva DEMO environment — all restaurants, dishes and orders here are fictitious.
          </div>
        )}
        <UiTextProvider text={getUiText(lang)}>{children}</UiTextProvider>
      </body>
    </html>
  );
}
