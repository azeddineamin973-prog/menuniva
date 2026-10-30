import { ButtonLink, EmptyState } from '@/components/ui';
import { isModuleKey, MODULE_LABELS } from '@/lib/modules';
import { requireTenantPage } from '@/server/tenant';

export default async function ModuleUnavailablePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ m?: string }> }) {
  const { org } = await params;
  const { m } = await searchParams;
  const ctx = await requireTenantPage(org);
  const label = m && isModuleKey(m) ? MODULE_LABELS[m] : 'This feature';
  return (
    <EmptyState
      title={`${label} is not included in your current plan`}
      description={ctx.can('billing.view') ? 'See your plan and what it includes on the Subscription page, or contact MenuNiva support to change it.' : 'Ask the restaurant owner if you need this feature.'}
      action={
        <div className="flex gap-2" data-testid="module-unavailable">
          {ctx.can('billing.view') && <ButtonLink href={`/dashboard/${ctx.org.slug}/subscription`}>Subscription</ButtonLink>}
          <ButtonLink href={`/dashboard/${ctx.org.slug}`} variant="secondary">Back to dashboard</ButtonLink>
        </div>
      }
    />
  );
}
