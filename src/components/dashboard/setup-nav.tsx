import Link from 'next/link';
import { ButtonLink, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { getSetupProgress, setupNav, type SetupStepKey } from '@/server/services/setup-progress';

/**
 * The wizard bar shown on top of each setup step page: where the owner is, what is still
 * missing here, and one tap back to the checklist or on to the next step.
 *
 * It disappears once every step is done, so a running restaurant is not permanently told it is
 * being set up. Each step page keeps working on its own if this renders nothing.
 */
export async function SetupStepNav({ orgSlug, orgId, stepKey, locationId }: { orgSlug: string; orgId: string; stepKey: SetupStepKey; locationId?: string | null }) {
  const progress = await getSetupProgress(orgId, locationId);
  const nav = setupNav(progress, stepKey);
  if (!nav || nav.completed === nav.total) return null;
  const base = `/dashboard/${orgSlug}`;
  const { step, next } = nav;
  return (
    <div className="mb-5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-xs" data-testid="setup-nav" data-step={stepKey} data-done={step.done}>
      <div className="flex items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <Link
          href={`${base}/setup`}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg pe-1 text-[13px] font-medium text-ink-2 hover:text-ink pointer-coarse:min-h-10"
          data-testid="setup-nav-back"
          aria-label="Back to setup"
        >
          <Icon name="arrowLeft" className="size-3.5 rtl:rotate-180" />
          <span className="hidden sm:inline">Back to setup</span>
          <span className="sm:hidden">Setup</span>
        </Link>
        <span className="h-5 w-px shrink-0 bg-line" aria-hidden />
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
          <span
            className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', step.done ? 'bg-graphite text-lime dark:bg-lime dark:text-lime-ink' : 'border border-accent/40 text-accent')}
            aria-hidden
          >
            {step.done ? <Icon name="check" className="size-3" /> : step.n}
          </span>
          <span className="min-w-0 truncate text-muted">
            <span className="text-ink">Step {step.n} of {nav.total}</span> · {step.title}
          </span>
          <span className={cn('hidden shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:inline', step.done ? 'bg-success/10 text-success' : 'bg-accent-soft text-accent')}>{step.done ? 'Done' : 'In progress'}</span>
        </span>
        {next ? (
          <ButtonLink href={`${base}${next.path}`} variant={step.done ? 'primary' : 'secondary'} size="sm" iconEnd="arrowRight" className="shrink-0" data-testid="setup-nav-next">
            <span>
              Next<span className="hidden md:inline">: {next.title}</span>
            </span>
          </ButtonLink>
        ) : (
          <ButtonLink href={`${base}/setup`} variant="primary" size="sm" iconEnd="arrowRight" className="shrink-0" data-testid="setup-nav-next">
            <span>
              Finish<span className="hidden md:inline"> setup</span>
            </span>
          </ButtonLink>
        )}
      </div>
      {/* Overall progress, as a thin bar along the bottom edge. */}
      <div className="h-0.5 bg-surface-2" aria-hidden>
        <div className="h-full bg-lime" style={{ width: `${(nav.completed / nav.total) * 100}%` }} />
      </div>
      {step.missing.length > 0 && (
        <ul className="space-y-0.5 border-t border-line bg-surface-2/40 px-4 py-2 text-xs text-ink-2" data-testid="setup-nav-missing">
          {step.missing.map((m) => (
            <li key={m} className="flex items-start gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warning" aria-hidden />
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
