import Link from 'next/link';
import { Badge, ButtonLink, Card, CardHeader } from '@/components/ui';
import type { SetupStep } from '@/server/services/setup-progress';
import { cn } from '@/lib/cn';

/**
 * The wizard checklist. Each unfinished step lists what is actually still missing, so the owner
 * does not have to open ten pages to find the one field that is blocking them.
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
        description={`${completed} of ${steps.length} steps completed`}
        action={
          onlyRemaining ? (
            <ButtonLink href={`${base}/setup`} variant="secondary" size="sm">
              Open setup
            </ButtonLink>
          ) : next ? (
            <Badge tone="lime">Next: {next.title}</Badge>
          ) : (
            <Badge tone="success">All steps completed</Badge>
          )
        }
      />
      <div className="px-5 pt-4">
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed}>
          <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className={cn('grid gap-2 p-5', !compact && 'sm:grid-cols-2')}>
        {shown.map((s) => (
          <li key={s.key}>
            <Link
              href={`${base}${s.path}`}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors hover:bg-surface-2',
                s.done ? 'border-line' : next?.key === s.key ? 'border-lime bg-lime/10' : 'border-line',
              )}
              data-testid={`setup-step-${s.key}`}
              data-done={s.done}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  s.done ? 'bg-graphite text-lime' : 'border border-line text-muted',
                )}
                aria-hidden
              >
                {s.done ? '✓' : s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.title}</span>
                {/* Once a step has concrete to-dos they replace the generic description: the
                    owner needs "postal code is missing", not "address, phone and country". */}
                {!compact && s.missing.length === 0 && <span className="block text-xs text-muted">{s.description}</span>}
                {!compact &&
                  s.missing.length > 0 && (
                    <span className="mt-0.5 block space-y-0.5" data-testid={`setup-missing-${s.key}`}>
                      {s.missing.map((m) => (
                        <span key={m} className="block text-xs text-warning">
                          {m}
                        </span>
                      ))}
                    </span>
                  )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
