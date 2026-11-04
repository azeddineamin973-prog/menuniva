import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui';
import { Container, ctaSize, onDarkSecondary, Perks, type Cta } from './ui';

export function FinalCta({ cta, perks, secondary }: { cta: Cta; perks: string[]; secondary: { href: string; label: string } | null }) {
  return (
    <section aria-labelledby="final-cta-title" className="pb-20 sm:pb-28">
      <Container>
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-graphite px-6 py-16 text-center text-white sm:px-12 sm:py-20 dark:ring-1 dark:ring-white/10">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="mn-grid-lines mn-on-dark mn-mask-center absolute inset-0" />
            <div className="absolute start-1/2 -bottom-40 h-80 w-[44rem] max-w-none -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(185_255_54/0.28),transparent)]" />
          </div>
          <span aria-hidden className="mx-auto block w-fit">
            <LogoMark className="h-14 w-14" />
          </span>
          <h2 id="final-cta-title" className="mx-auto mt-8 max-w-2xl text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            Your menu, in every language, <span className="text-lime">on every table.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-white/65">Set up your restaurant today and take your first order from a table, a pickup or a delivery.</p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 min-[400px]:flex-row min-[400px]:items-center">
            <ButtonLink href={cta.href} size="lg" iconEnd="arrowRight" className={ctaSize}>
              {cta.label}
            </ButtonLink>
            {secondary && (
              <ButtonLink href={secondary.href} variant="ghost" size="lg" className={`${ctaSize} ${onDarkSecondary}`}>
                {secondary.label}
              </ButtonLink>
            )}
          </div>
          <Perks items={perks} tone="dark" className="mt-7 justify-center" />
        </div>
      </Container>
    </section>
  );
}

const FOOTER_PRODUCT = [
  { href: '#one-menu', label: 'Menu import' },
  { href: '#every-order', label: 'Ordering' },
  { href: '#kitchen', label: 'Kitchen displays' },
  { href: '#every-language', label: 'Languages' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

const footerLink = 'inline-flex min-h-9 items-center text-sm text-muted transition-colors hover:text-ink';

export function SiteFooter({ account, supportEmail }: { account: { href: string; label: string }[]; supportEmail: string | null }) {
  return (
    <footer className="border-t border-line">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" aria-label="MenuNiva home" className="inline-flex rounded-lg">
            <Logo />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">One Menu. Every Order. Every Language. Made for restaurants, cafés and takeaways in Portugal and Spain.</p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-sm font-semibold text-ink">Product</h2>
          <ul className="mt-3 grid">
            {FOOTER_PRODUCT.map((l) => (
              <li key={l.href}>
                <a href={l.href} className={footerLink}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account">
          <h2 className="text-sm font-semibold text-ink">Account</h2>
          <ul className="mt-3 grid">
            {account.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={footerLink}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-semibold text-ink">Contact</h2>
          <ul className="mt-3 grid">
            {supportEmail ? (
              <li>
                <a href={`mailto:${supportEmail}`} className={`${footerLink} break-all`}>
                  {supportEmail}
                </a>
              </li>
            ) : (
              <li className="py-2 text-sm leading-relaxed text-muted">Restaurants on MenuNiva reach Support from their dashboard.</li>
            )}
          </ul>
        </div>
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} MenuNiva</span>
          <span>Payments are taken at the restaurant. MenuNiva receipts are not legal invoices.</span>
        </Container>
      </div>
    </footer>
  );
}
