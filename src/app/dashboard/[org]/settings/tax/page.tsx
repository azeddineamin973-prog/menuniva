import { ActionForm, FieldError } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { TAX_SUGGESTIONS } from '@/server/services/menu-advanced';
import { requireTenantPage } from '@/server/tenant';
import { deleteTaxClassAction, saveTaxClassAction } from '../../menu/actions';
import { SettingsTabs } from '../tabs';

export default async function TaxPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const [o, classes] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { country: true } }),
    db.taxClass.findMany({ where: { organizationId: ctx.org.id }, orderBy: { rateBasisPoints: 'desc' }, include: { _count: { select: { products: true } } } }),
  ]);
  const existing = new Set(classes.map((c) => c.name));
  const suggestions = TAX_SUGGESTIONS[o.country].filter((s) => !existing.has(s.name));
  const pct = (bps: number) => (bps / 100).toLocaleString('pt-PT', { maximumFractionDigits: 2 });
  return (
    <>
      <PageHeader title="Tax (IVA)" description="Menu prices are entered with VAT included. Tax classes record which VAT rate applies to each dish, for your accounting and future certified invoicing." />
      <SettingsTabs base={`/dashboard/${ctx.org.slug}`} active="tax" />
      <div className="mb-6">
        <Alert tone="warning" title="Confirm rates with your accountant">
          MenuNiva does not decide which VAT rate applies to food, drinks or alcohol, and rates differ by region (e.g. Madeira, Azores, Canary Islands). Only approved classes can be assigned to dishes.
        </Alert>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your tax classes" />
          {classes.length === 0 ? (
            <CardBody className="text-sm text-muted">None yet.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {classes.map((c) => (
                <li key={c.id} className="px-5 py-3">
                  <ActionForm action={saveTaxClassAction} submitLabel="Save" submitVariant="secondary" className="space-y-2">
                    <input type="hidden" name="org" value={ctx.org.slug} />
                    <input type="hidden" name="id" value={c.id} />
                    <div className="grid grid-cols-[1fr_100px] gap-2">
                      <Input name="name" defaultValue={c.name} aria-label="Name" />
                      <Input name="rate" defaultValue={pct(c.rateBasisPoints)} aria-label="Rate %" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Checkbox name="approved" label="Approved by the restaurant" defaultChecked={!!c.approvedAt} />
                      {c.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Not approved</Badge>}
                      <span className="text-xs text-muted">{c._count.products} dishes</span>
                    </div>
                  </ActionForm>
                  {c._count.products === 0 && <InlineAction action={deleteTaxClassAction} fields={{ org: ctx.org.slug, id: c.id }} label="Delete" variant="ghost" />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Add a tax class" />
          <CardBody>
            <ActionForm action={saveTaxClassAction} submitLabel="Add tax class" resetOnSuccess testId="tax-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="Name" htmlFor="tname"><Input id="tname" name="name" required /></Field>
              <Field label="Rate (%)" htmlFor="trate"><Input id="trate" name="rate" required inputMode="decimal" placeholder="13" /><FieldError name="rate" /></Field>
              <Checkbox name="approved" label="I confirm this rate applies to my restaurant." />
            </ActionForm>
            {suggestions.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-sm font-medium">Common {o.country === 'PT' ? 'Portuguese mainland' : 'Spanish'} rates (starting points — verify before approving)</p>
                {suggestions.map((s) => (
                  <ActionForm key={s.name} action={saveTaxClassAction} submitLabel={`Add “${s.name}” ${pct(s.rateBasisPoints)} % (unapproved)`} submitVariant="secondary" className="space-y-0">
                    <input type="hidden" name="org" value={ctx.org.slug} />
                    <input type="hidden" name="name" value={s.name} />
                    <input type="hidden" name="rate" value={pct(s.rateBasisPoints)} />
                  </ActionForm>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
