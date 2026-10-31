import Link from 'next/link';
import { SetupProgressBar, StepMarker } from '@/components/dashboard/setup-checklist';
import { Alert, Badge, ButtonLink, Card, CardHeader, Icon, PageHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { db } from '@/server/db';
import { currentLocation } from '@/server/current-location';
import { getSetupProgress } from '@/server/services/setup-progress';
import { requireTenantPage } from '@/server/tenant';
import { MagicSetup } from './magic-setup';

export default async function SetupWizardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  // The checklist is judged against the location the owner currently has selected, so in a
  // multi-location restaurant the tables and publishing they just did actually register.
  const selected = await currentLocation(ctx);
  const { steps, completed, locationId } = await getSetupProgress(ctx.org.id, selected?.id);
  const next = steps.find((s) => !s.done);
  const base = `/dashboard/${ctx.org.slug}`;
  const location = locationId ? await db.restaurantLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true, city: true, websiteUrl: true } }) : null;
  const detailsDone = steps.find((s) => s.key === 'details')?.done ?? false;
  const todo = steps.filter((s) => !s.done && s.actionable && s.missing.length > 0);
  const allDone = completed === steps.length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <>
      <PageHeader
        title="Set up your restaurant"
        meta={<Badge tone={allDone ? 'success' : 'neutral'}>{completed} of {steps.length} done</Badge>}
        description="Start by finding your restaurant: we fill in your address, phone, hours and links for you to check. Then add your menu and tables."
        actions={
          <ButtonLink href={`${base}/preview`} variant="secondary" icon="phone" data-testid="preview-restaurant-button">
            Preview my restaurant
          </ButtonLink>
        }
      />

      {allDone ? (
        <div className="mb-6">
          <Alert tone="success" title="Your restaurant is live" action={<ButtonLink href={base} variant="secondary" size="sm">Go to overview</ButtonLink>}>
            Guests can scan your table QR codes and order.
          </Alert>
        </div>
      ) : (
        next && (
          // The one thing to do now, so the owner never has to decide where to start.
          <Card className="mb-6 overflow-hidden">
            <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-lime text-base font-semibold text-lime-ink tabular-nums" aria-hidden>
                {next.n}
              </span>
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">Up next · step {next.n} of {steps.length}</p>
                <p className="text-base font-semibold text-ink">{next.title}</p>
                <p className="text-sm text-muted">{next.missing.length > 0 ? next.missing.join(' ') : next.description}</p>
              </div>
              <ButtonLink href={`${base}${next.path}`} size="lg" iconEnd="arrowRight" className="shrink-0">
                Continue
              </ButtonLink>
            </div>
            <SetupProgressBar completed={completed} total={steps.length} className="h-1 rounded-none" />
          </Card>
        )
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {location && (
            // One fixed position in the tree. Saving revalidates this page, and a component that
            // moved into a different wrapper would be remounted — losing the confirmation the
            // owner needs to see. Collapsing is handled inside the component instead.
            <MagicSetup
              org={ctx.org.slug}
              locationId={location.id}
              startCollapsed={detailsDone}
              initial={{ name: location.name, city: location.city, websiteUrl: location.websiteUrl }}
            />
          )}

          <Card>
            <CardHeader title="All steps" icon="wand" description="Open any step. Your progress is saved after each one." action={<Badge tone={allDone ? 'success' : 'neutral'}>{pct}%</Badge>} />
            <ol className="p-2 sm:p-3">
              {steps.map((s, i) => {
                const current = next?.key === s.key;
                return (
                  <li key={s.key} className="relative">
                    {/* Connector between markers */}
                    {i < steps.length - 1 && <span className={cn('absolute start-[1.4rem] top-10 bottom-0 w-px', s.done ? 'bg-graphite/40 dark:bg-lime/40' : 'bg-line')} aria-hidden />}
                    <Link
                      href={`${base}${s.path}`}
                      className={cn('group relative flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-surface-2/60', current && 'bg-accent-soft/50 hover:bg-accent-soft/70')}
                      data-testid={`setup-step-${s.key}`}
                      data-done={s.done}
                      aria-current={current ? 'step' : undefined}
                    >
                      <span className="pt-px">
                        <StepMarker step={s} current={current} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={cn('text-sm font-medium', s.done ? 'text-ink-2' : 'text-ink')}>{s.title}</span>
                          {s.done && <span className="text-xs text-success">Done</span>}
                          {current && <Badge tone="lime">Next</Badge>}
                        </span>
                        {/* Concrete to-dos replace the generic description once a step has them. */}
                        {s.missing.length === 0 ? (
                          <span className="block text-xs text-muted">{s.description}</span>
                        ) : (
                          <span className="mt-0.5 block space-y-0.5" data-testid={`setup-missing-${s.key}`}>
                            {s.missing.map((m) => (
                              <span key={m} className="block text-xs text-warning">
                                {m}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <Icon name="chevronRight" className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20" aria-label="Setup summary">
          <Card className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink-2">Progress</p>
              <p className="text-sm text-muted tabular-nums">
                <span className="text-2xl font-semibold text-ink">{completed}</span> / {steps.length}
              </p>
            </div>
            <SetupProgressBar completed={completed} total={steps.length} className="mt-3" />
            <p className="mt-3 text-xs text-muted">{allDone ? 'Every step is complete.' : `${steps.length - completed} steps left. Most take a minute or two.`}</p>
          </Card>

          {todo.length > 0 && (
            <Card data-testid="setup-todo">
              <CardHeader title="What still needs you" icon="alert" />
              {/* One row per step: what is missing, and the way to fix it. */}
              <ul className="divide-y divide-line">
                {todo.map((s) => (
                  <li key={s.key} className="flex flex-col gap-2 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{s.title}</span>
                      <span className="block text-xs text-ink-2">{s.missing.join(' ')}</span>
                    </span>
                    <ButtonLink href={`${base}${s.path}`} variant="secondary" size="sm" iconEnd="arrowRight" className="self-start">
                      Fix now
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="flex items-start gap-2 px-1 text-xs text-muted">
            <Icon name="shield" className="mt-px size-3.5 shrink-0" />
            MenuNiva never creates sample dishes, prices, tables or opening hours for your restaurant. Discovered details are only saved after you review them, and allergen information is only shown to
            guests after you verify it.
          </p>
        </aside>
      </div>
    </>
  );
}
