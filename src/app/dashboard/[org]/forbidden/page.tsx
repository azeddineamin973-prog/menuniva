import { ButtonLink, EmptyState } from '@/components/ui';

export default async function ForbiddenPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return (
    <EmptyState
      title="You don't have access to this section"
      description="Your role does not include this area. Ask the restaurant owner or manager if you need access."
      action={<ButtonLink href={`/dashboard/${org}`} variant="secondary">Back to dashboard</ButtonLink>}
    />
  );
}
