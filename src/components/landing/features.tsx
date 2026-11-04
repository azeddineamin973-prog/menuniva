import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { AnalyticsMock, BillMock, FeedbackMock, FloorPlanMock, GrowMock } from './feature-mockups';
import { Container, ctaSize, SectionHeading, type Cta } from './ui';

function BentoCard({ icon, title, body, visual, className }: { icon: IconName; title: string; body: ReactNode; visual: ReactNode; className?: string }) {
  return (
    <article className={cn('mn-reveal flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-xs', className)}>
      <div className="p-6 pb-0 sm:p-7 sm:pb-0">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name={icon} className="size-[18px]" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{body}</p>
      </div>
      <div aria-hidden className="mt-6 flex flex-1 flex-col justify-end bg-gradient-to-b from-transparent to-surface-2/70 p-6 pt-0 sm:p-7 sm:pt-0">
        {visual}
      </div>
    </article>
  );
}

const EXTRAS = [
  'Seven staff roles, from owner to kitchen',
  'Several locations in one account',
  'Cart suggestions, never added for the guest',
  'Guest data export and erasure',
  'Light and dark mode',
  'Works on phones, tablets and desktops',
];

export function AroundTheMeal() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-16 border-t border-line bg-surface-2/50 py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="features-title"
          align="center"
          eyebrow="Everything around the meal"
          title="Reservations, bills, reviews and regulars."
          lead="Switch on the tools you need. They live next to your menu and orders, so nothing has to be copied between apps."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <BentoCard
            className="md:col-span-2"
            icon="calendar"
            title="Reservations and floor plan"
            body="Guests request a table online. Draw your rooms, place your tables, and MenuNiva prevents double bookings."
            visual={<FloorPlanMock />}
          />
          <BentoCard
            icon="star"
            title="Private feedback"
            body="Guests rate their visit privately, and every guest sees the same Google review link, whatever their rating."
            visual={<FeedbackMock />}
          />
          <BentoCard icon="bill" title="Bills and split payments" body="Split a bill between guests and record each payment, by card or in cash." visual={<BillMock />} />
          <BentoCard icon="tag" title="Promotions and loyalty" body="Discounts, combos and codes with usage limits, plus points or stamps that guests join with consent." visual={<GrowMock />} />
          <BentoCard
            icon="chart"
            title="Analytics"
            body="Sales by channel, hour and dish, with paid and unpaid kept apart. Export to CSV."
            visual={<AnalyticsMock />}
          />
        </div>
        <ul className="mn-reveal mx-auto mt-10 flex max-w-4xl flex-wrap justify-center gap-2">
          {EXTRAS.map((e) => (
            <li key={e} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 shadow-xs">
              <Icon name="check" className="size-3.5 text-accent" strokeWidth={2.2} />
              {e}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'building', title: 'Create your restaurant', body: 'Sign up and paste your Google Maps link or website. Address, phone and opening hours are filled in for you.' },
  { icon: 'import', title: 'Import your menu', body: 'From Glovo, Uber Eats, Excel, CSV, PDF or text. Check prices, allergens and which station prepares each dish.' },
  { icon: 'qr', title: 'Print your QR codes and publish', body: 'Download a QR code for every table as PNG, SVG or PDF, open your kitchen screens and go live.' },
];

export function HowItWorks({ cta }: { cta: Cta }) {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="how-title"
          align="center"
          eyebrow="How it works"
          title="From sign-up to your first order."
          lead="A setup checklist shows exactly what is left to do. Your restaurant stays private until you publish it."
        />
        <ol className="relative mt-14 grid gap-4 lg:grid-cols-3 lg:gap-6">
          <span aria-hidden className="absolute inset-x-[16%] top-[2.75rem] hidden border-t border-dashed border-line-strong lg:block" />
          {STEPS.map((s, i) => (
            <li key={s.title} className="mn-reveal relative rounded-3xl border border-line bg-surface p-6 shadow-xs sm:p-7">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-lime text-sm font-semibold text-lime-ink ring-4 ring-bg">{i + 1}</span>
                <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2">
                  <Icon name={s.icon} className="size-[18px]" />
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex justify-center">
          <ButtonLink href={cta.href} size="lg" iconEnd="arrowRight" className={ctaSize}>
            {cta.label}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
