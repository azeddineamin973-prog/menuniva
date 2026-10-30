import { Card, CardBody, PageHeader } from '@/components/ui';
import { CreateTenantForm } from './form';

export default function NewTenantPage() {
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
