import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, PageHeader } from '@/components/ui';
import { publishChecks } from '@/server/services/publish';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { publishAction, unpublishAction } from '../actions';

export default async function PublishPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const loc = await currentLocation(ctx);
  if (!loc) return <Alert tone="warning">No location.</Alert>;
  const { location, blockers, warnings, unrouted, stations } = await publishChecks(ctx, loc.id);
  return (
    <>
      <PageHeader title="Publish" description="Publishing makes your menu public and turns on the ordering channels you enabled." />
      <Card className="max-w-2xl">
        <CardHeader title={location.name} action={location.isPublished ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Not published</Badge>} />
        <CardBody className="space-y-4">
          {blockers.length > 0 && (
            <Alert tone="danger" title="Before you can publish">
              <ul className="list-disc ps-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert tone="warning" title="Please check">
              <ul className="list-disc ps-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Alert>
          )}
          {location.isPublished ? (
            <ActionForm action={unpublishAction} submitLabel="Unpublish (hide menu and stop orders)" submitVariant="danger">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
            </ActionForm>
          ) : (
            <ActionForm action={publishAction} submitLabel="Publish now" testId="publish-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <Checkbox name="confirm" label="I reviewed the dishes, prices and translations. Allergen information shown to guests has been verified by the restaurant." />
              {stations > 0 && unrouted.length > 0 && (
                <Checkbox name="confirmUnrouted" label={`The ${unrouted.length} dishes without a kitchen station need no preparation (they will not appear on any kitchen screen).`} />
              )}
            </ActionForm>
          )}
        </CardBody>
      </Card>
    </>
  );
}
