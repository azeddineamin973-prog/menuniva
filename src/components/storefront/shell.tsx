import type { CSSProperties } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import { dirOf, LANGUAGE_TAG } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';

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
}: {
  branding: Branding;
  restaurantName: string;
  subtitle?: string;
  lang: LanguageCode;
  languages: LanguageCode[];
  children: React.ReactNode;
  compactHeader?: boolean;
  poweredBy: string;
}) {
  const style = {
    '--sf-primary': branding?.primaryColor ?? '#1F5C4A',
    '--sf-accent': branding?.accentColor ?? '#B8975A',
    '--sf-bg': branding?.backgroundColor ?? '#FBF7EE',
    '--sf-text': branding?.textColor ?? '#1E2420',
  } as CSSProperties;
  const serif = (branding?.headingFont ?? 'serif') === 'serif';
  return (
    <div lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)} style={style} className={cn('min-h-dvh bg-sf-bg text-sf-text', branding?.themePreset === 'moroccan' && 'sf-pattern')} data-testid="storefront">
      <header className="relative overflow-hidden bg-sf-primary text-white">
        {branding?.coverUrl && !compactHeader && <img src={branding.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />}
        <div className={cn('relative mx-auto flex max-w-3xl items-center gap-3 px-4', compactHeader ? 'py-3' : 'pt-6 pb-5')}>
          {branding?.logoUrl && <img src={branding.logoUrl} alt="" className={cn('rounded-2xl bg-white object-contain p-1', compactHeader ? 'h-10 w-10' : 'h-14 w-14')} />}
          <div className="min-w-0 flex-1">
            <h1 className={cn('truncate leading-tight', serif ? 'font-serif' : 'font-semibold', compactHeader ? 'text-lg' : 'text-2xl')}>{restaurantName}</h1>
            {subtitle && <p className="truncate text-sm text-white/80">{subtitle}</p>}
          </div>
          {languages.length > 1 && <LanguageCookieSwitcher current={lang} available={languages} className="[&_select]:border-white/30 [&_select]:bg-white/10 [&_select]:text-white" />}
        </div>
        <div aria-hidden className="h-1 bg-sf-accent" />
      </header>
      {children}
      <footer className="mx-auto max-w-3xl px-4 py-8 text-center text-xs opacity-60">{poweredBy}</footer>
    </div>
  );
}
