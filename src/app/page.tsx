import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui';

const FEATURES = [
  ['QR table ordering', 'Guests scan, browse in their language and order from the table. No app download, no customer login.'],
  ['Kitchen & café displays', 'Each order is split by station. Food goes to the kitchen, tea to the café, and the order is ready only when every station is.'],
  ['Takeaway & own delivery', 'Pickup slots, postal-code delivery zones for Portugal and Spain, and a simple staff delivery view.'],
  ['Five languages', 'Português, English, Français, العربية (right-to-left) and Español, with a translation review step before publishing.'],
  ['Menu Import Studio', 'Bring your menu from CSV, Excel, PDF or pasted text, review every item, then publish. Nothing is published without your confirmation.'],
  ['Private feedback', 'Guests rate their visit privately. The Google review link is shown to every guest, whatever their rating.'],
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">Sign in</ButtonLink>
          <ButtonLink href="/signup">Start free trial</ButtonLink>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-10 pb-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-graphite px-8 py-16 text-white sm:px-14 sm:py-20">
          <div aria-hidden className="absolute -end-20 -top-20 h-72 w-72 rounded-full bg-lime/15 blur-3xl" />
          <LogoMark className="mb-8 h-14 w-14" />
          <h1 className="max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
            One Menu. Every Order. <span className="text-lime">Every Language.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            MenuNiva is the restaurant platform for table QR ordering, takeaway, your own delivery, kitchen displays,
            reservations and private guest feedback — built for restaurants in Portugal and Spain.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href="/signup" size="lg">Register your restaurant</ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              Sign in
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-white/50">
            Monthly subscription. MenuNiva takes no commission on orders placed through your own MenuNiva channels.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <div className="mb-4 h-1.5 w-10 rounded-full bg-lime" />
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted">
          <span>© MenuNiva</span>
          <span>
            Payments are taken at the restaurant. Online payments and certified invoicing require separate providers.
          </span>
          <Link href="/login" className="hover:text-ink">Staff sign in</Link>
        </div>
      </footer>
    </div>
  );
}
