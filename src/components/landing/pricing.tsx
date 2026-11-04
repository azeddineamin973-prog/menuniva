import { ButtonLink } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import type { PlanCard, PlanLimitKey } from './plans';
import { Container, SectionHeading, type Cta } from './ui';

const LIMIT_ICON: Record<PlanLimitKey, IconName> = { locations: 'building', tables: 'tables', staff: 'users', menuItems: 'book' };

/**
 * Plans exactly as configured in Super Admin → Plans. A plan without a price says "On request":
 * MenuNiva never shows a price that has not been set.
 */
export function Pricing({ plans, cta, trialNote }: { plans: PlanCard[] | null; cta: Cta; trialNote: string | null }) {
  const anyPrice = plans?.some((p) => p.price !== null) ?? false;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-16 border-t border-line bg-surface py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="pricing-title"
          align="center"
          eyebrow="Pricing"
          title={anyPrice ? 'Simple monthly plans.' : 'A plan for every kind of restaurant.'}
          lead="One monthly subscription per restaurant, and no commission on orders through your own MenuNiva channels."
        />
        {trialNote && (
          <p className="mn-reveal mx-auto mt-8 flex w-fit max-w-full items-center gap-2 rounded-full border border-lime/60 bg-accent-soft px-4 py-2 text-center text-sm font-medium text-ink">
            <Icon name="sparkles" className="size-4 shrink-0 text-accent" />
            {trialNote}
          </p>
        )}

        {plans && plans.length > 0 && (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="landing-plans">
            {plans.map((p) => (
              <article key={p.code} className="mn-reveal flex flex-col rounded-3xl border border-line bg-bg p-6 shadow-xs" data-testid="landing-plan">
                <h3 className="text-lg font-semibold text-ink">{p.name}</h3>
                {p.description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.description}</p>}
                <p className="mt-6 flex items-baseline gap-1.5">
                  {p.price ? (
                    <>
                      <span className="text-4xl font-semibold tracking-tight text-ink tabular-nums">{p.price}</span>
                      <span className="text-sm text-muted">/ month</span>
                    </>
                  ) : (
                    <span className="text-2xl font-semibold tracking-tight text-ink">On request</span>
                  )}
                </p>
                {p.limits.length > 0 && (
                  <ul className="mt-5 grid gap-2 text-sm text-ink-2">
                    {p.limits.map((l) => (
                      <li key={l.key} className="flex items-center gap-2">
                        <Icon name={LIMIT_ICON[l.key]} className="size-4 text-muted" />
                        {l.text}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="my-6 h-px bg-line" />
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">{p.includesFrom ? `Everything in ${p.includesFrom}${p.features.length ? ', plus' : ''}` : 'Includes'}</p>
                {p.features.length > 0 && (
                  <ul className="mt-3 grid gap-2.5 text-sm text-ink">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Icon name="check" className="mt-0.5 size-4 text-accent" strokeWidth={2.2} />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto pt-7">
                  <ButtonLink href={cta.href} variant="secondary" size="lg" className="w-full rounded-xl!">
                    {cta.label}
                  </ButtonLink>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-muted">
          Guests pay at your restaurant: at the counter, to the waiter, or on delivery. Online payments and certified invoicing need separate providers.
        </p>
      </Container>
    </section>
  );
}
