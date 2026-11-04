import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { LanguageCode } from '@/generated/prisma/enums';
import { dirOf, LANGUAGE_TAG } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';
import { storefrontPalette } from '@/lib/color';
import { MediaImage } from '@/components/ui/media-image';

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

/**
 * Restaurant-branded wrapper for every guest page: colours, fonts, language and direction.
 *
 * Two headers, one design system:
 * - the restaurant home (`compactHeader` false): a brand band in the restaurant's primary colour,
 *   or its cover photo, with logo, name, tagline and a status line;
 * - ordering, checkout and order pages (`compactHeader`): a quiet sticky bar (back, logo, name),
 *   so food photos and the order stay the focus.
 */
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
  backHref,
  backLabel,
  homeHref,
  homeLabel,
  wide = false,
  footer,
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
  /** Compact header only: an arrow back to the previous step. */
  backHref?: string;
  backLabel?: string;
  /** The restaurant's home page: the logo and name link to it. */
  homeHref?: string;
  homeLabel?: string;
  /** Wider page (menu with a cart column on desktop). */
  wide?: boolean;
  /** The restaurant's footer (StorefrontFooter); without it, one quiet "Powered by" line. */
  footer?: React.ReactNode;
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
  const pattern = branding?.themePreset === 'moroccan';
  const width = wide ? 'max-w-7xl' : 'max-w-5xl';
  /** Logo + name: a link to the restaurant's home page when there is one. */
  const brand = (className: string, content: React.ReactNode) =>
    homeHref ? (
      <Link href={homeHref} title={homeLabel} className={cn(className, 'rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current')} data-testid="restaurant-home-link">
        {content}
      </Link>
    ) : (
      <div className={className}>{content}</div>
    );
  const switcher = (dark: boolean) =>
    languages.length > 1 && (
      <LanguageCookieSwitcher
        current={lang}
        available={languages}
        className={cn(
          // 16 px text: iOS zooms into smaller fields.
          'shrink-0 [&_select]:h-10 [&_select]:max-w-[8.5rem] [&_select]:cursor-pointer [&_select]:rounded-full [&_select]:border-0 [&_select]:px-3 [&_select]:pe-7 [&_select]:text-base [&_select]:font-medium',
          dark ? '[&_select]:bg-white/15 [&_select]:text-current [&_select]:ring-1 [&_select]:ring-white/25 [&_select]:backdrop-blur' : '[&_select]:bg-sf-sunken [&_select]:text-sf-text [&_select]:ring-1 [&_select]:ring-sf-line',
        )}
      />
    );
  return (
    <div
      lang={LANGUAGE_TAG[lang]}
      dir={dirOf(lang)}
      // Guest pages follow the restaurant's colours, whatever theme a staff member chose for the
      // dashboard. Native controls match a dark brand background.
      style={{ ...style, colorScheme: p.dark ? 'dark' : 'light' }}
      className={cn('sf-root flex min-h-dvh flex-col bg-sf-bg text-sf-text antialiased [&_option]:bg-white [&_option]:text-[#171a1d]', serif && 'sf-serif')}
      data-testid="storefront"
      data-palette={p.dark ? 'dark' : 'light'}
    >
      {compactHeader ? (
        <header className="sticky top-0 z-30 border-b border-sf-line bg-sf-card/95 backdrop-blur supports-[backdrop-filter]:bg-sf-card/85">
          <div className={cn('mx-auto flex h-16 items-center gap-3 px-4 sm:px-6', width)}>
            {backHref && (
              <a href={backHref} aria-label={backLabel} title={backLabel} className="-ms-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-sf-sunken" data-testid="back-to-menu">
                <svg viewBox="0 0 24 24" className="size-5 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </a>
            )}
            {brand(
              'flex min-w-0 flex-1 items-center gap-3',
              <>
                {branding?.logoUrl && <MediaImage src={branding.logoUrl} sizes="40px" widths={[160]} className="size-10 shrink-0 rounded-xl bg-white object-contain p-0.5 ring-1 ring-sf-line" width={40} height={40} decoding="async" />}
                <div className="min-w-0 flex-1">
                  <h1 dir="auto" className={cn('truncate text-[17px] leading-tight rtl:text-right', serif ? 'font-serif text-lg' : 'font-semibold')} title={restaurantName}>
                    {restaurantName}
                  </h1>
                  {subtitle && (
                    <p dir="auto" className="truncate text-[13px] text-sf-muted rtl:text-right">
                      {subtitle}
                    </p>
                  )}
                </div>
              </>,
            )}
            {switcher(false)}
          </div>
        </header>
      ) : (
        <header className={cn('relative overflow-hidden', cover ? 'bg-[#111] text-white' : 'bg-sf-primary text-sf-on-primary', !cover && pattern && 'sf-band-pattern')}>
          {cover && (
            <>
              {/* The largest image of the page: requested first. Phones get at most the 960 px copy. */}
              <MediaImage src={cover} sizes="100vw" widths={[640, 960, 1280, 1920]} phoneWidths={[640, 960]} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" decoding="async" />
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/15" />
            </>
          )}
          {/* With a cover: a big store banner (the photo fills it, name and status at its foot). */}
          <div className={cn('relative mx-auto px-4 sm:px-6', width, cover ? 'flex min-h-[19rem] flex-col justify-end pt-20 pb-7 sm:min-h-[24rem] sm:pb-10 lg:min-h-[28rem]' : 'pt-6 pb-7 sm:pt-10 sm:pb-10')} data-testid={cover ? 'store-cover' : undefined}>
            <div className="absolute end-4 top-4 sm:end-6">{switcher(true)}</div>
            {brand(
              cn('flex items-end gap-4', !cover && 'pe-28 sm:pe-36'),
              <>
                {branding?.logoUrl && (
                  <MediaImage
                    src={branding.logoUrl}
                    sizes="96px"
                    widths={[160, 320]}
                    className={cn('shrink-0 rounded-2xl bg-white object-contain p-1 shadow-lg ring-1 ring-black/5', cover ? 'size-20 ring-4 ring-white/90 sm:size-24' : 'size-16 sm:size-20')}
                    width={96}
                    height={96}
                    decoding="async"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {/* dir="auto": a Latin restaurant name inside an Arabic page is cut at its end, not its start. */}
                  <h1 dir="auto" className={cn('line-clamp-2 leading-[1.08] tracking-tight break-words rtl:text-right', cover ? 'text-[2rem] drop-shadow-[0_2px_12px_rgb(0_0_0/0.35)] sm:text-[2.8rem] lg:text-[3.2rem]' : 'text-[1.75rem] sm:text-[2.4rem]', serif ? 'font-serif' : 'font-semibold')} title={restaurantName}>
                    {restaurantName}
                  </h1>
                  {subtitle && (
                    <p dir="auto" className="mt-1 line-clamp-2 text-sm opacity-85 rtl:text-right sm:text-[15px]">
                      {subtitle}
                    </p>
                  )}
                </div>
              </>,
            )}
            {headerMeta && <div className="mt-4 flex flex-wrap items-center gap-2">{headerMeta}</div>}
          </div>
          {/* A thin line of the accent colour (gold for the Moroccan theme). */}
          <div aria-hidden className="relative h-[3px] bg-sf-accent" />
        </header>
      )}
      <div className="flex-1">{children}</div>
      {footer ?? <footer className={cn('mx-auto w-full px-4 py-8 text-center text-xs text-sf-muted', width)}>{poweredBy}</footer>}
    </div>
  );
}
