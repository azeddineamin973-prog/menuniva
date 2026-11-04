import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/** Main call to action, decided once per request (trial, dashboard, contact) and used everywhere. */
export type Cta = { href: string; label: string; short: string };

export type Point = { icon: IconName; title: string; body: ReactNode };

/** Large landing buttons: taller and rounder than dashboard buttons. */
export const ctaSize = 'h-12! rounded-xl! px-6! text-base!';
/** Secondary button drawn on graphite panels. */
export const onDarkSecondary = 'border border-white/15 bg-white/5! text-white! hover:bg-white/10! hover:text-white!';

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

export function Eyebrow({ children, index, tone = 'light' }: { children: ReactNode; index?: string; tone?: 'light' | 'dark' }) {
  return (
    <p className={cn('inline-flex items-center gap-2 text-sm font-semibold', tone === 'dark' ? 'text-lime' : 'text-accent')}>
      {index && <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-xs', tone === 'dark' ? 'bg-lime/15' : 'bg-accent-soft')}>{index}</span>}
      {children}
    </p>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  index,
  title,
  lead,
  align = 'start',
  tone = 'light',
  className,
}: {
  id?: string;
  eyebrow?: ReactNode;
  index?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'start' | 'center';
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <div className={cn('mn-reveal max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && (
        <Eyebrow index={index} tone={tone}>
          {eyebrow}
        </Eyebrow>
      )}
      <h2 id={id} className={cn('mt-3 text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]', tone === 'dark' ? 'text-white' : 'text-ink')}>
        {title}
      </h2>
      {lead && <p className={cn('mt-4 text-base leading-relaxed text-pretty sm:text-lg', tone === 'dark' ? 'text-white/65' : 'text-muted')}>{lead}</p>}
    </div>
  );
}

/** Icon, short title and one sentence: the supporting points next to each product illustration. */
export function Points({ items, tone = 'light', className }: { items: Point[]; tone?: 'light' | 'dark'; className?: string }) {
  return (
    <ul className={cn('grid gap-6', className)}>
      {items.map((p) => (
        <li key={p.title} className="mn-reveal flex gap-4">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              tone === 'dark' ? 'bg-white/[0.06] text-lime ring-1 ring-white/10' : 'border border-line bg-surface text-ink shadow-xs',
            )}
          >
            <Icon name={p.icon} className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className={cn('font-semibold', tone === 'dark' ? 'text-white' : 'text-ink')}>{p.title}</h3>
            <p className={cn('mt-1 text-[15px] leading-relaxed', tone === 'dark' ? 'text-white/60' : 'text-muted')}>{p.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "✓ 30-day free trial  ✓ No card required" line under the main buttons. */
export function Perks({ items, tone = 'light', className }: { items: string[]; tone?: 'light' | 'dark'; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-sm', tone === 'dark' ? 'text-white/70' : 'text-muted', className)}>
      {items.map((p) => (
        <li key={p} className="inline-flex items-center gap-1.5">
          <Icon name="check" className={cn('size-4', tone === 'dark' ? 'text-lime' : 'text-accent')} strokeWidth={2.2} />
          {p}
        </li>
      ))}
    </ul>
  );
}
