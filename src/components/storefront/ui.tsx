'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/icons';

/**
 * Storefront design system: the few building blocks every guest page uses. Colours come from the
 * restaurant (sf-* tokens), so the same components look right for every tenant.
 *
 *   Touch targets ≥ 44 px · one primary action per screen · 16 px inputs (no iOS zoom).
 */

type BtnVariant = 'primary' | 'secondary' | 'ghost';
type BtnSize = 'md' | 'lg';
export function sfButton(variant: BtnVariant = 'primary', size: BtnSize = 'md', className?: string) {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none motion-reduce:active:scale-100',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-primary',
    size === 'lg' ? 'h-14 px-6 text-[17px]' : 'h-12 px-5 text-[15px]',
    variant === 'primary' && 'bg-sf-primary text-sf-on-primary shadow-[var(--sf-shadow-float)] hover:brightness-[1.06] disabled:shadow-none',
    variant === 'secondary' && 'bg-sf-card text-sf-text ring-1 ring-sf-line hover:bg-sf-sunken',
    variant === 'ghost' && 'text-sf-text hover:bg-sf-sunken',
    className,
  );
}

/** − 1 + control. `compact` for cart lines. */
export function Stepper({ value, onChange, min = 1, max = 50, compact = false, labels, disabled }: { value: number; onChange: (n: number) => void; min?: number; max?: number; compact?: boolean; labels: { minus: string; plus: string; quantity: string }; disabled?: boolean }) {
  const btn = cn('flex items-center justify-center rounded-full transition-colors disabled:opacity-30', compact ? 'size-9' : 'size-11', 'hover:bg-sf-sunken');
  return (
    <div className={cn('inline-flex items-center rounded-full bg-sf-card ring-1 ring-sf-line', compact ? 'p-0.5' : 'p-1')}>
      <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={labels.minus}>
        <Icon name={value <= 1 && min === 0 ? 'trash' : 'minus'} className="size-4" />
      </button>
      <span className={cn('text-center font-semibold tabular-nums', compact ? 'w-6 text-sm' : 'w-8')} aria-label={labels.quantity} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={labels.plus}>
        <Icon name="plus" className="size-4" />
      </button>
    </div>
  );
}

export const SF_INPUT =
  'h-[3.25rem] w-full rounded-2xl border-0 bg-sf-card px-4 text-base text-sf-text ring-1 ring-sf-line placeholder:text-sf-muted/70 focus:ring-2 focus:ring-sf-primary focus:outline-none aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

/** Label above the control, error under it; the control gets the id and the error's id. */
export function SfField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-sf-muted">{hint}</span>}
      </label>
      {children(id, error ? `${id}-err` : undefined)}
      {error && (
        <p id={`${id}-err`} className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-red-700" data-testid="field-error">
          <Icon name="alert" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Heading of a block of a form or page. */
export function SfSection({ title, action, children, className, testId }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn('space-y-3', className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A small info line with an icon (fees, payment, notes). */
export function SfNote({ icon, tone = 'muted', children, testId, role }: { icon: IconName; tone?: 'muted' | 'warn' | 'error' | 'brand'; children: React.ReactNode; testId?: string; role?: 'alert' | 'status' }) {
  return (
    <p
      role={role}
      data-testid={testId}
      className={cn(
        'flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm',
        tone === 'muted' && 'bg-sf-sunken text-sf-muted',
        tone === 'warn' && 'bg-amber-50 text-amber-900',
        tone === 'error' && 'bg-red-50 text-red-800',
        tone === 'brand' && 'bg-sf-soft text-sf-text',
      )}
    >
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Where the guest is in the order: Choose → Details → Confirmed. Finished steps show a tick and,
 * when given a link, take the guest back (e.g. to the menu to change the order).
 */
export function JourneySteps({ steps, current, label, className }: { steps: { label: string; href?: string }[]; current: number; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={className} data-testid="journey-steps">
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => {
          const done = i < current;
          const now = i === current;
          const dot = (
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums transition-colors',
                done && 'bg-sf-primary text-sf-on-primary',
                now && 'bg-sf-primary text-sf-on-primary ring-4 ring-sf-primary/15',
                !done && !now && 'bg-sf-sunken text-sf-muted ring-1 ring-sf-line',
              )}
              aria-hidden
            >
              {done || (now && i === steps.length - 1) ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
          );
          const text = <span className={cn('truncate text-[13px] sm:text-sm', now ? 'font-semibold text-sf-text' : done ? 'font-medium text-sf-text' : 'text-sf-muted')}>{s.label}</span>;
          return (
            <li key={i} className={cn('flex min-w-0 items-center gap-2', i < steps.length - 1 && 'flex-1')} aria-current={now ? 'step' : undefined} data-state={done ? 'done' : now ? 'current' : 'todo'}>
              {done && s.href ? (
                <a href={s.href} className="-m-1 flex min-h-11 min-w-0 items-center gap-2 rounded-full p-1 hover:underline focus-visible:outline-2 focus-visible:outline-sf-primary">
                  {dot}
                  {text}
                </a>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  {dot}
                  {text}
                </span>
              )}
              {i < steps.length - 1 && <span className={cn('h-0.5 min-w-3 flex-1 rounded-full', done ? 'bg-sf-primary' : 'bg-sf-line')} aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
