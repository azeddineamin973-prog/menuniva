import { Card, CardBody, PageHeader } from '@/components/ui';
import { CreateTenantForm } from './form';
import { requirePlatformAdminPage } from '@/server/tenant';

export default async function NewTenantPage() {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  return (
    <>
      <PageHeader title="Create restaurant tenant" description="Creates the restaurant with a manual trial. If the owner has no account yet, an invitation link is generated for you to send." />
      <Card className="max-w-xl">
        <CardBody>
          <CreateTenantForm />
        </CardBody>
      </Card>
    </>
  );
}
