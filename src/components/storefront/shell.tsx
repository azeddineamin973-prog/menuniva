import type { CSSProperties } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import { dirOf, LANGUAGE_TAG } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';
import { storefrontPalette } from '@/lib/color';

export type Branding = {
  logoUrl: string | null;
  coverUrl: string | null;
  themePreset: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  headingFont: string;
  tagline: string | null;
} | null;

/** Restaurant-branded wrapper for every customer page: colours, fonts, language and direction. */
export function StorefrontShell({
  branding,
  restaurantName,
  subtitle,
  lang,
  languages,
  children,
  compactHeader = false,
  poweredBy,
  headerMeta,
}: {
  branding: Branding;
  restaurantName: string;
  subtitle?: string;
  lang: LanguageCode;
  languages: LanguageCode[];
  children: React.ReactNode;
  compactHeader?: boolean;
  poweredBy: string;
  /** Small status line under the name (e.g. open now). */
  headerMeta?: React.ReactNode;
}) {
  const p = storefrontPalette(branding);
  const style = {
    '--sf-primary': p.primary,
    '--sf-accent': p.accent,
    '--sf-bg': p.bg,
    '--sf-text': p.text,
    '--sf-on-primary': p.onPrimary,
    '--sf-primary-ink': p.primaryInk,
    '--sf-card': p.card,
    '--sf-secondary': p.secondary,
    '--sf-on-secondary': p.onSecondary,
  } as CSSProperties;
  const serif = (branding?.headingFont ?? 'serif') === 'serif';
  const cover = branding?.coverUrl && !compactHeader ? branding.coverUrl : null;
  return (
    <div
      lang={LANGUAGE_TAG[lang]}
      dir={dirOf(lang)}
      // Guest pages follow the restaurant's colours, whatever theme a staff member chose for the
      // dashboard. Native controls match a dark brand background.
      style={{ ...style, colorScheme: p.dark ? 'dark' : 'light' }}
      className={cn('min-h-dvh bg-sf-bg text-sf-text antialiased [&_option]:bg-white [&_option]:text-[#171a1d]', branding?.themePreset === 'moroccan' && 'sf-pattern')}
      data-testid="storefront"
      data-palette={p.dark ? 'dark' : 'light'}
    >
      <header className={cn('relative overflow-hidden', cover ? 'bg-[#111] text-white' : 'bg-sf-primary text-sf-on-primary')}>
        <div className={cn('relative z-10 mx-auto flex max-w-5xl gap-3 px-4 sm:px-6', compactHeader ? 'items-center py-3' : cover ? 'min-h-48 items-end pt-14 pb-5 sm:min-h-56' : 'items-center pt-6 pb-5')}>
          {branding?.logoUrl && (
            <img
              src={branding.logoUrl}
              alt=""
              className={cn('shrink-0 rounded-2xl bg-white object-contain p-1 shadow-md ring-1 ring-black/10', compactHeader ? 'h-10 w-10' : 'h-16 w-16')}
              width={compactHeader ? 40 : 64}
              height={compactHeader ? 40 : 64}
            />
          )}
          <div className="min-w-0 flex-1">
            {/* dir="auto": a Latin restaurant name inside an Arabic page is cut at its end, not its start. */}
            <h1
              dir="auto"
              // Full header: long names wrap to two lines instead of being cut to "Casa …" on phones.
              className={cn('leading-tight tracking-tight break-words rtl:text-right', serif ? 'font-serif' : 'font-semibold', compactHeader ? 'truncate text-lg' : 'line-clamp-2 text-2xl sm:text-3xl')}
              title={restaurantName}
            >
              {restaurantName}
            </h1>
            {subtitle && (
              <p dir="auto" className={cn('mt-0.5 text-sm opacity-85 rtl:text-right', compactHeader ? 'truncate' : 'line-clamp-2')}>
                {subtitle}
              </p>
            )}
            {headerMeta && !compactHeader && <div className="mt-2 flex flex-wrap items-center gap-2">{headerMeta}</div>}
          </div>
          {languages.length > 1 && (
            <LanguageCookieSwitcher
              current={lang}
              available={languages}
              // Over a cover photo the switcher sits in the top corner, leaving the name the full width.
              className={cn('shrink-0 [&_select]:border-current/30 [&_select]:bg-current/10 [&_select]:text-current [&_select]:backdrop-blur', cover && 'absolute end-4 top-4 sm:end-6')}
            />
          )}
        </div>
        {cover && (
          <>
            {/* Placed after the title in the DOM (logo stays the first image). Full-strength photo with a gradient behind the text: readable on any image. */}
            <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" decoding="async" />
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
          </>
        )}
        <div aria-hidden className="relative z-10 h-1 bg-sf-accent" />
      </header>
      {children}
      <footer className="mx-auto max-w-5xl px-4 py-10 text-center text-xs opacity-60">{poweredBy}</footer>
    </div>
  );
}
