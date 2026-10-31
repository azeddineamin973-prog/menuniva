import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { Alert, ButtonLink, PageHeader } from '@/components/ui';
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

  return (
    <>
      <PageHeader
        title="Set up your restaurant"
        description="Start by finding your restaurant — we fill in your address, phone, hours and links for you to check. Your progress is saved after each step."
        actions={next && <ButtonLink href={`${base}${next.path}`} variant="secondary">Continue: {next.title}</ButtonLink>}
      />

      {completed === steps.length && (
        <div className="mb-6">
          <Alert tone="success" title="Your restaurant is live">
            Guests can scan your table QR codes and order.
          </Alert>
        </div>
      )}

      {location && (
        <div className="mb-6">
          {/* One fixed position in the tree. Saving revalidates this page, and a component that
              moved into a different wrapper would be remounted — losing the confirmation the
              owner needs to see. Collapsing is handled inside the component instead. */}
          <MagicSetup
            org={ctx.org.slug}
            locationId={location.id}
            startCollapsed={detailsDone}
            initial={{ name: location.name, city: location.city, websiteUrl: location.websiteUrl }}
          />
        </div>
      )}

      {todo.length > 0 && (
        <div className="mb-6" data-testid="setup-todo">
          <Alert tone="warning" title="What still needs you">
            {/* One row per step: what is missing on the left, the way to fix it on the right. */}
            <ul className="mt-2 divide-y divide-warning/20">
              {todo.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-1 last:pb-0">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block font-medium text-ink">{s.title}</span>
                    <span className="block text-sm">{s.missing.join(' ')}</span>
                  </span>
                  <ButtonLink href={`${base}${s.path}`} variant="secondary" size="sm" className="shrink-0">
                    Fix now →
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <SetupChecklist steps={steps} base={base} />
      <p className="mt-4 text-xs text-muted">
        MenuNiva never creates sample dishes, prices, tables or opening hours for your restaurant. Discovered details are only saved after you review them, and allergen information is only shown to
        guests after you verify it.
      </p>
    </>
  );
}
