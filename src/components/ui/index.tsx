import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// MenuNiva dashboard UI primitives (server-component friendly, no client JS).
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost' | 'dark';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex max-w-full items-center justify-center gap-2 rounded-xl font-medium transition-[color,background-color,border-color,filter,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 whitespace-nowrap';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-lime text-graphite hover:brightness-95 shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]',
  dark: 'bg-graphite text-white hover:bg-black dark:bg-white dark:text-graphite dark:hover:bg-white/90',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  // Dark mode uses a lighter red, so the label switches to graphite to stay readable.
  danger: 'bg-danger text-white hover:brightness-110 dark:text-graphite',
  // Destructive but secondary (cancel an order, delete a member): red text, no loud fill.
  dangerGhost: 'text-danger hover:bg-danger/10',
};
// Touch screens (phones, the restaurant's tablet) get taller controls: 40 px for small buttons,
// 44 px for regular ones — mouse users keep the compact sizes.
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm pointer-coarse:h-10',
  md: 'h-10 px-4 text-sm pointer-coarse:h-11',
  lg: 'h-12 px-5 text-base',
};

/**
 * Lets a button label wrap onto a second line instead of pushing the page wider than a phone
 * (long labels such as a restaurant name or "Unpublish (hide menu and stop orders)").
 * Same height as a regular button while the label fits on one line.
 */
export const wrapButtonClass = 'h-auto! min-h-10 py-2 text-center whitespace-normal! pointer-coarse:min-h-11';

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** Class for <summary> disclosure toggles ("Edit", "Reduce or remove"): a real tap target. */
export const disclosureClass =
  '-mx-2 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10';

/** Small text-styled action (filters, "Search", "Apply") that is still at least 32/40 px tall. */
export const textButtonClass =
  'inline-flex min-h-8 items-center rounded-lg px-2 text-sm font-medium text-ink underline underline-offset-2 hover:bg-surface-2 pointer-coarse:min-h-10';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}

// 16 px text on touch screens: iOS Safari zooms the whole page into any field smaller than that.
const fieldBase =
  'w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-[var(--mn-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--mn-focus)]/25 disabled:opacity-60 pointer-coarse:text-base';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-10 pointer-coarse:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-[88px] py-2', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'h-10 pe-8 pointer-coarse:h-11', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-ink', className)} {...props} />;
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
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {optionalLabel && <span className="ms-1 font-normal text-muted">({optionalLabel})</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, description, className, ...props }: ComponentProps<'input'> & { label: ReactNode; description?: ReactNode }) {
  // The whole label is the tap target; on touch screens it is at least 32 px tall.
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 py-0.5 pointer-coarse:py-1.5', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-line accent-[#7ac70c] pointer-coarse:size-5" {...props} />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

type Tone = 'neutral' | 'lime' | 'success' | 'warning' | 'danger' | 'info' | 'dark' | 'brand';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-line',
  lime: 'bg-lime/25 text-[#3d5c00] border-lime/50 dark:text-lime',
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  info: 'bg-info/10 text-info border-info/25',
  // Graphite on a graphite dark-mode surface was invisible (role and "source" badges): invert it.
  dark: 'bg-graphite text-white border-graphite dark:bg-white dark:text-graphite dark:border-white',
  // Solid lime, for badges on dark headers where the translucent lime tone cannot be read.
  brand: 'bg-lime text-graphite border-lime',
};

export function Badge({ tone = 'neutral', className, ...props }: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}
      {...props}
    />
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: Exclude<Tone, 'neutral' | 'dark' | 'lime'>; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', tones[tone])} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(!!title && 'mt-0.5', 'text-ink/80')}>{children}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Key figure. Compact on phones, where stats sit two per row (see `statGrid`). */
export function Stat({ label, value, hint, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums sm:mt-2 sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  if (href)
    return (
      <Link href={href} className="block rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-ink/25 hover:bg-surface-2 sm:p-5">
        {body}
      </Link>
    );
  return <Card className="p-4 sm:p-5">{body}</Card>;
}

/** Grid for a row of <Stat>: two per row on phones, `cols` from small screens up. */
export function statGrid(cols: 2 | 3 | 4 = 3, extra?: string) {
  return cn('grid grid-cols-2 gap-3 sm:gap-4', cols === 3 && 'sm:grid-cols-3', cols === 4 && 'lg:grid-cols-4', extra);
}
