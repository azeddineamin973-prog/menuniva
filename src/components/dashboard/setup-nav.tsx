import Link from 'next/link';
import { Badge, ButtonLink } from '@/components/ui';
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
    <div className="mb-5 rounded-[var(--radius-card)] border border-line bg-surface" data-testid="setup-nav" data-step={stepKey} data-done={step.done}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Link href={`${base}/setup`} className="inline-flex min-h-9 items-center text-sm font-medium underline-offset-4 hover:underline pointer-coarse:min-h-10" data-testid="setup-nav-back">
          ← Back to setup
        </Link>
        <span className="text-sm text-muted">
          Step {step.n} of {nav.total} · {step.title}
        </span>
        {step.done ? <Badge tone="success">Done</Badge> : <Badge tone="lime">In progress</Badge>}
        <div className="ms-auto flex flex-wrap gap-2">
          {next ? (
            <ButtonLink href={`${base}${next.path}`} variant={step.done ? 'primary' : 'secondary'} size="sm" data-testid="setup-nav-next">
              Next: {next.title} →
            </ButtonLink>
          ) : (
            <ButtonLink href={`${base}/setup`} variant="primary" size="sm" data-testid="setup-nav-next">
              Finish setup →
            </ButtonLink>
          )}
        </div>
      </div>
      {step.missing.length > 0 && (
        <ul className="list-disc space-y-0.5 border-t border-line px-4 py-2 ps-9 text-xs text-muted" data-testid="setup-nav-missing">
          {step.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
