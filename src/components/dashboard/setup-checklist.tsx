import Link from 'next/link';
import { Badge, ButtonLink, Card, CardHeader, Icon } from '@/components/ui';
import type { SetupStep } from '@/server/services/setup-progress';
import { cn } from '@/lib/cn';

/** Progress bar shared by the checklist and the wizard. */
export function SetupProgressBar({ completed, total, className }: { completed: number; total: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
      <div className="h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${(completed / total) * 100}%` }} />
    </div>
  );
}

/** Round step marker: a check when done, the step number otherwise. */
export function StepMarker({ step, current }: { step: Pick<SetupStep, 'n' | 'done'>; current?: boolean }) {
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
        step.done ? 'bg-graphite text-lime dark:bg-lime dark:text-lime-ink' : current ? 'bg-lime text-lime-ink ring-4 ring-lime/25' : 'border border-line-strong bg-surface text-muted',
      )}
      aria-hidden
    >
      {step.done ? <Icon name="check" className="size-3.5" /> : step.n}
    </span>
  );
}

/**
 * The setup checklist (used on the overview). Each unfinished step lists what is actually still
 * missing, so the owner does not have to open ten pages to find the one field that is blocking them.
 */
export function SetupChecklist({ steps, base, compact = false, onlyRemaining = false }: { steps: SetupStep[]; base: string; compact?: boolean; onlyRemaining?: boolean }) {
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  // The overview lists only what is left; the setup wizard itself shows every step.
  const shown = onlyRemaining ? steps.filter((s) => !s.done) : steps;
  return (
    <Card>
      <CardHeader
        title="Restaurant setup"
        icon="wand"
        description={`${completed} of ${steps.length} steps completed`}
        action={
          onlyRemaining ? (
            <ButtonLink href={`${base}/setup`} variant="secondary" size="sm" iconEnd="arrowRight">
              Open setup
            </ButtonLink>
          ) : next ? (
            <Badge tone="lime">Next: {next.title}</Badge>
          ) : (
            <Badge tone="success">All steps completed</Badge>
          )
        }
      />
      <div className="px-4 pt-4 sm:px-5">
        <SetupProgressBar completed={completed} total={steps.length} />
      </div>
      <ol className={cn('grid gap-2 p-4 sm:p-5', !compact && 'sm:grid-cols-2')}>
        {shown.map((s) => (
          <li key={s.key}>
            <Link
              href={`${base}${s.path}`}
              className={cn(
                'group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2/50',
                next?.key === s.key ? 'border-lime/70 bg-accent-soft/50' : 'border-line',
              )}
              data-testid={`setup-step-${s.key}`}
              data-done={s.done}
            >
              <StepMarker step={s} current={next?.key === s.key} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', s.done ? 'text-ink-2' : 'text-ink')}>{s.title}</span>
                {/* Once a step has concrete to-dos they replace the generic description: the
                    owner needs "postal code is missing", not "address, phone and country". */}
                {!compact && s.missing.length === 0 && <span className="block text-xs text-muted">{s.description}</span>}
                {!compact && s.missing.length > 0 && (
                  <span className="mt-0.5 block space-y-0.5" data-testid={`setup-missing-${s.key}`}>
                    {s.missing.map((m) => (
                      <span key={m} className="block text-xs text-warning">
                        {m}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <Icon name="chevronRight" className="mt-1 size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
