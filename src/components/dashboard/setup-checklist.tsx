import Link from 'next/link';
import { Badge, Card, CardHeader } from '@/components/ui';
import type { SetupStep } from '@/server/services/setup-progress';
import { cn } from '@/lib/cn';

export function SetupChecklist({ steps, base, compact = false }: { steps: SetupStep[]; base: string; compact?: boolean }) {
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <Card>
      <CardHeader
        title="Restaurant setup"
        description={`${completed} of ${steps.length} steps completed`}
        action={next ? <Badge tone="lime">Next: {next.title}</Badge> : <Badge tone="success">All steps completed</Badge>}
      />
      <div className="px-5 pt-4">
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed}>
          <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className={cn('grid gap-2 p-5', !compact && 'sm:grid-cols-2')}>
        {steps.map((s) => (
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
              <span>
                <span className="block text-sm font-medium">{s.title}</span>
                {!compact && <span className="block text-xs text-muted">{s.description}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
