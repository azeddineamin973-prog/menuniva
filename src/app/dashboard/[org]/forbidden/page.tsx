import { ButtonLink, EmptyState } from '@/components/ui';
import { requireTenantPage } from '@/server/tenant';

export default async function ForbiddenPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  await requireTenantPage(org); // members only; no specific permission needed to see this notice
  return (
    <EmptyState
      title="You don't have access to this section"
      description="Your role does not include this area. Ask the restaurant owner or manager if you need access."
      action={<ButtonLink href={`/dashboard/${org}`} variant="secondary">Back to dashboard</ButtonLink>}
    />
  );
}
