import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { Alert, ButtonLink, PageHeader } from '@/components/ui';
import { getSetupProgress } from '@/server/services/setup-progress';
import { requireTenantPage } from '@/server/tenant';

export default async function SetupWizardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const { steps, completed } = await getSetupProgress(ctx.org.id);
  const next = steps.find((s) => !s.done);
  const base = `/dashboard/${ctx.org.slug}`;
  return (
    <>
      <PageHeader
        title="Setup wizard"
        description="Ten steps from an empty account to a published menu. Your progress is saved automatically after each step; you can stop and come back any time."
        actions={next && <ButtonLink href={`${base}${next.path}`}>Continue: {next.title}</ButtonLink>}
      />
      {completed === steps.length && <div className="mb-4"><Alert tone="success" title="Your restaurant is live">Guests can scan your table QR codes and order.</Alert></div>}
      <SetupChecklist steps={steps} base={base} />
      <p className="mt-4 text-xs text-muted">
        MenuNiva never creates sample dishes, prices, tables or opening hours for your restaurant. Allergen information is only shown to guests after you verify it.
      </p>
    </>
  );
}
