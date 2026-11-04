import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';
import { Container, SectionHeading } from './ui';

export type FaqItem = { q: string; a: ReactNode };

/** Native <details> disclosures: keyboard and screen-reader friendly, no script needed. */
export function Faq({ items, supportEmail }: { items: FaqItem[]; supportEmail: string | null }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 py-20 sm:py-28">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            id="faq-title"
            eyebrow="FAQ"
            title="Questions, answered."
            lead={
              supportEmail ? (
                <>
                  Something else on your mind? Write to{' '}
                  <a href={`mailto:${supportEmail}`} className="font-medium text-ink underline underline-offset-4 hover:text-accent">
                    {supportEmail}
                  </a>
                  .
                </>
              ) : (
                'Something else on your mind? Once you have an account, Support is one click away in your dashboard.'
              )
            }
          />
        </div>
        <div className="divide-y divide-line border-y border-line">
          {items.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-start text-base font-medium text-ink transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition-transform duration-200 group-open:rotate-45">
                  <Icon name="plus" className="size-4" />
                </span>
              </summary>
              <div className="pe-12 pb-5 text-[15px] leading-relaxed text-muted">{item.a}</div>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
