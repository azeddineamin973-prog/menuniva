import { ActionForm } from '@/components/forms/action-form';
import { ButtonLink, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { markPreviewedAction } from '../actions';

export default async function PreviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const firstTable = location ? await db.restaurantTable.findFirst({ where: { locationId: location.id, isActive: true }, include: { qrTokens: { where: { isActive: true }, take: 1 } } }) : null;
  const url = `/r/${ctx.org.slug}?preview=1`;
  return (
    <>
      <PageHeader title="Preview your customer menu" description="This is exactly what guests will see on their phones. Check names, prices, photos and every language." actions={<ButtonLink href={url} target="_blank" variant="secondary">Open in a new tab ↗</ButtonLink>} />
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        <div className="mx-auto h-[760px] w-[390px] overflow-hidden rounded-[2.5rem] border-[10px] border-graphite shadow-xl">
          <iframe src={url} title="Customer menu preview" className="h-full w-full bg-white" />
        </div>
        <Card>
          <CardHeader title="Checklist" />
          <CardBody className="space-y-3 text-sm">
            <p>✓ Switch languages with the selector at the top of the preview (Arabic displays right-to-left).</p>
            <p>✓ Open a dish and check sizes, extras and allergen information.</p>
            <p>✓ Add items to the order and check the total.</p>
            {firstTable?.qrTokens[0] && <p>✓ Table view: <a className="underline" href={`/t/${firstTable.qrTokens[0].token}`} target="_blank" rel="noreferrer">open table {firstTable.label}</a> (ordering works only after publishing).</p>}
            <ActionForm action={markPreviewedAction} submitLabel="I have reviewed the preview" successText="Recorded">
              <input type="hidden" name="org" value={ctx.org.slug} />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
