import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui';
import { MobileMenu } from './mobile-menu';
import type { Cta } from './ui';

export const LANDING_NAV = [
  { href: '#one-menu', label: 'Product' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
] as const;

export function SiteHeader({ cta, showSignIn }: { cta: Cta; showSignIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="MenuNiva home" className="me-auto shrink-0 rounded-lg lg:me-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="mx-auto hidden items-center gap-0.5 lg:flex">
          {LANDING_NAV.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showSignIn && (
            <ButtonLink href="/login" variant="ghost" className="max-sm:hidden!">
              Sign in
            </ButtonLink>
          )}
          <ButtonLink href={cta.href} className="px-3! sm:px-3.5!" data-testid="landing-header-cta">
            <span className="sm:hidden">{cta.short}</span>
            <span className="hidden sm:inline">{cta.label}</span>
          </ButtonLink>
          <MobileMenu links={LANDING_NAV} cta={cta} showSignIn={showSignIn} />
        </div>
      </div>
    </header>
  );
}
