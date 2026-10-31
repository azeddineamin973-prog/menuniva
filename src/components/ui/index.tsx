import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icons';

export { Icon, type IconName } from './icons';

// ---------------------------------------------------------------------------
// MenuNiva design system — dashboard primitives (server-component friendly).
// Sizes: compact for mouse users, larger on touch screens (`pointer-coarse:`).
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost' | 'dark';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex max-w-full shrink-0 select-none items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border border-black/5 bg-lime text-lime-ink shadow-xs hover:bg-lime-hover',
  dark: 'bg-graphite text-white shadow-xs hover:bg-black dark:bg-white dark:text-graphite dark:hover:bg-white/90',
  secondary: 'border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  // Dark mode uses a lighter red, so the label switches to graphite to stay readable.
  danger: 'bg-danger text-white shadow-xs hover:brightness-110 dark:text-graphite',
  // Destructive but secondary (cancel an order, delete a member): red text, no loud fill.
  dangerGhost: 'text-danger hover:bg-danger/10',
};
// Touch screens (phones, the restaurant's tablet) get taller controls: 40 px for small buttons,
// 44 px for regular ones — mouse users keep the compact sizes.
const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs pointer-coarse:h-9',
  sm: 'h-8 px-2.5 text-[13px] pointer-coarse:h-10 pointer-coarse:px-3',
  md: 'h-9 px-3.5 text-sm pointer-coarse:h-11',
  lg: 'h-11 px-5 text-[15px] pointer-coarse:h-12',
};

/**
 * Lets a button label wrap onto a second line instead of pushing the page wider than a phone
 * (long labels such as a restaurant name or "Unpublish (hide menu and stop orders)").
 * Same height as a regular button while the label fits on one line.
 */
export const wrapButtonClass = 'h-auto! min-h-9 py-1.5 text-center whitespace-normal! pointer-coarse:min-h-11';

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-4 animate-spin', className)} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
export { Spinner };

type ButtonExtras = { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconEnd?: IconName; loading?: boolean };

export function Button({ variant = 'primary', size = 'md', className, icon, iconEnd, loading, children, disabled, ...props }: ComponentProps<'button'> & ButtonExtras) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner /> : icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </button>
  );
}

export function ButtonLink({ variant = 'primary', size = 'md', className, icon, iconEnd, children, ...props }: ComponentProps<typeof Link> & Omit<ButtonExtras, 'loading'>) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </Link>
  );
}

/** Square icon-only button; `label` becomes the accessible name and tooltip. */
export function IconButton({ icon, label, variant = 'ghost', size = 'md', className, ...props }: Omit<ComponentProps<'button'>, 'children'> & { icon: IconName; label: string; variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(buttonBase, buttonVariants[variant], size === 'sm' ? 'size-8 pointer-coarse:size-10' : 'size-9 pointer-coarse:size-11', 'px-0', className)}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

// ------------------------------------------------------------------- surfaces

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-xs', className)} {...props} />;
}

export function CardHeader({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && (
          <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            <Icon name={icon} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] leading-6 font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-4 py-3 sm:px-5', className)} {...props} />;
}

/**
 * Settings-style section: what it is and why on the left, the fields on the right (stacked on
 * phones). Keeps long forms scannable without a card per field.
 */
export function Section({ title, description, children, className, id }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('grid gap-4 border-b border-line py-6 first:pt-0 last:border-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8', className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------- forms

// 16 px text on touch screens: iOS Safari zooms the whole page into any field smaller than that.
const fieldBase =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-xs transition-[border-color,box-shadow] placeholder:text-muted/70 hover:border-line-strong focus:border-[var(--mn-focus)] focus:ring-3 focus:ring-[var(--mn-focus)]/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger pointer-coarse:text-base';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-9 pointer-coarse:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-[88px] py-2 leading-6', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'h-9 pe-8 pointer-coarse:h-11', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-[13px] font-medium text-ink', className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optionalLabel,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  optionalLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={htmlFor}>
        {label}
        {optionalLabel && <span className="ms-1 font-normal text-muted">({optionalLabel})</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs leading-4 text-muted">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, description, className, ...props }: ComponentProps<'input'> & { label: ReactNode; description?: ReactNode }) {
  // The whole label is the tap target; on touch screens it is at least 32 px tall.
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 py-0.5 pointer-coarse:py-1.5', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line accent-[#6cb30a] pointer-coarse:size-5" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-4 text-muted">{description}</span>}
      </span>
    </label>
  );
}

// ------------------------------------------------------------- status & text

type Tone = 'neutral' | 'lime' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'dark' | 'brand';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  lime: 'bg-accent-soft text-accent border-lime/40',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-info/10 text-info border-info/20',
  violet: 'bg-violet/10 text-violet border-violet/20',
  // Graphite on a graphite dark-mode surface was invisible (role and "source" badges): invert it.
  dark: 'bg-graphite text-white border-graphite dark:bg-white dark:text-graphite dark:border-white',
  // Solid lime, for badges on dark headers where the translucent lime tone cannot be read.
  brand: 'bg-lime text-lime-ink border-lime',
};
const dotTones: Record<Tone, string> = {
  neutral: 'bg-muted',
  lime: 'bg-lime',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
  dark: 'bg-current',
  brand: 'bg-lime-ink',
};

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }: ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px text-[11px] leading-[18px] font-medium whitespace-nowrap', tones[tone], className)} {...props}>
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', dotTones[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Small coloured status dot, e.g. before "Live" or "Occupied". */
export function Dot({ tone = 'neutral', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dotTones[tone])} />}
      <span className={cn('relative size-2 rounded-full', dotTones[tone])} />
    </span>
  );
}

const ALERT_ICON: Record<'success' | 'warning' | 'danger' | 'info', IconName> = { success: 'checkCircle', warning: 'alert', danger: 'alert', info: 'info' };

export function Alert({ tone = 'info', title, children, action }: { tone?: 'success' | 'warning' | 'danger' | 'info'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', tones[tone])} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICON[tone]} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(!!title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Link to the parent screen, shown above the title. */
  back?: { href: string; label: string };
  /** Small badges/status next to the title. */
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-6">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1.5 inline-flex min-h-7 items-center gap-1 text-[13px] text-muted hover:text-ink pointer-coarse:min-h-10">
            <Icon name="arrowLeft" className="size-3.5" /> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl leading-tight font-semibold tracking-tight text-ink sm:text-[22px]">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode | IconName }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-strong/70 bg-surface px-6 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
        {typeof icon === 'string' ? <Icon name={icon as IconName} className="size-5" /> : (icon ?? <Icon name="inbox" className="size-5" />)}
      </div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-[13px] leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Key figure. Compact on phones, where stats sit two per row (see `statGrid`). */
export function Stat({ label, value, hint, href, icon, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; href?: string; icon?: IconName; tone?: 'lime' | 'warning' | 'danger' | 'info' | 'success' }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        {icon && <Icon name={icon} className={cn('size-3.5', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger', tone === 'info' && 'text-info', tone === 'success' && 'text-success', tone === 'lime' && 'text-accent')} />}
        <span className="min-w-0 leading-4">{label}</span>
      </p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs leading-4 text-muted">{hint}</p>}
    </>
  );
  if (href)
    return (
      <Link href={href} className="group block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2/60">
        {body}
      </Link>
    );
  return <Card className="p-4">{body}</Card>;
}

/** Grid for a row of <Stat>: two per row on phones, `cols` from small screens up. */
export function statGrid(cols: 2 | 3 | 4 = 3, extra?: string) {
  return cn('grid grid-cols-2 gap-3', cols === 3 && 'sm:grid-cols-3', cols === 4 && 'lg:grid-cols-4', extra);
}

/** Class for <summary> disclosure toggles ("Edit", "Reduce or remove"): a real tap target. */
export const disclosureClass =
  '-mx-2 inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden';

/** Small text-styled action (filters, "Search", "Apply") that is still at least 32/40 px tall. */
export const textButtonClass =
  'inline-flex min-h-8 items-center rounded-lg px-2 text-sm font-medium text-ink underline underline-offset-2 hover:bg-surface-2 pointer-coarse:min-h-10';

/**
 * Navigation tabs (links). Underlined on wide screens, horizontally scrollable on phones.
 * Use for sub-pages of one area (settings, menu tools).
 */
export function Tabs({ items, className, label }: { items: { href: string; label: ReactNode; active?: boolean; count?: number; icon?: IconName }[]; className?: string; label?: string }) {
  return (
    <nav aria-label={label} className={cn('mn-scroll -mx-4 mb-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      <ul className="flex gap-1">
        {items.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={cn(
                '-mb-px flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors pointer-coarse:min-h-11',
                t.active ? 'border-ink font-medium text-ink dark:border-lime' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.icon && <Icon name={t.icon} />}
              {t.label}
              {t.count !== undefined && <span className="rounded-md bg-surface-2 px-1.5 text-[11px] tabular-nums">{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Keyboard shortcut hint. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[11px] text-muted', className)}>{children}</kbd>;
}

// ------------------------------------------------------------------ filters & disclosure

/** Filter chip (link or button). Same look everywhere: menu filters, inboxes, date ranges. */
export function chipClass(active: boolean, extra?: string) {
  return cn(
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-10',
    active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
    extra,
  );
}

export function FilterChip({ href, active, count, children, className, ...props }: ComponentProps<typeof Link> & { active: boolean; count?: number }) {
  return (
    <Link href={href} aria-current={active ? 'true' : undefined} className={chipClass(active, className as string | undefined)} {...props}>
      {children}
      {count !== undefined && <span className={cn('rounded px-1 text-[11px] tabular-nums', active ? 'bg-white/15 dark:bg-black/15' : 'bg-surface-2 text-muted')}>{count}</span>}
    </Link>
  );
}

/** Horizontal, scrollable row of filter chips (one line on phones). */
export function ChipRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <nav aria-label={label} className={cn('mn-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {children}
    </nav>
  );
}

export { Disclosure } from './disclosure';

/** "OUT_FOR_DELIVERY" → "Out for delivery". For enum values shown to staff. */
export function humanize(value: string) {
  const s = value.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
