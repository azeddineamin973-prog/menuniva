import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { dirOf, isLanguage, LANG_COOKIE, LANGUAGE_TAG } from '@/i18n/config';
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
  const lang = isLanguage(langCookie) ? langCookie : 'pt';
  const dark = jar.get('mn_theme')?.value === 'dark';
  return (
    <html lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)} className={dark ? 'dark' : undefined} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
