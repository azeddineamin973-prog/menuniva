import { ActionForm } from '@/components/forms/action-form';
import { env } from '@/server/env';
import { Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { saveBrandingAction } from '../actions';
import { SettingsTabs } from '../tabs';
import { BrandingPresetPicker } from './preset-picker';
import { BrandImages } from './brand-images';

export default async function BrandingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const b = await db.restaurantBranding.findUnique({ where: { organizationId: ctx.org.id } });
  const base = `/dashboard/${ctx.org.slug}`;
  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="branding" />
      <PageHeader title="Branding" description="Your customer menu uses your own logo, photos and colours. MenuNiva branding stays discreet." />
      <SettingsTabs base={base} active="branding" />
      <Card>
        <CardHeader title="Customer menu style" description="Cover photo, logo, colours and fonts of your restaurant page and online ordering." />
        <CardBody>
          <ActionForm action={saveBrandingAction} testId="branding-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                {/* Keyed by the saved images, so the preview resets after each save. */}
                <BrandImages key={`${b?.logoUrl}|${b?.coverUrl}`} logoUrl={b?.logoUrl ?? null} coverUrl={b?.coverUrl ?? null} restaurantName={ctx.org.name} tagline={b?.tagline ?? null} maxBytes={env.UPLOAD_MAX_BYTES} />
                <Field label="Tagline" htmlFor="tagline" optionalLabel="optional">
                  <Input id="tagline" name="tagline" maxLength={140} defaultValue={b?.tagline ?? ''} />
                </Field>
                <Field label="Heading style" htmlFor="headingFont">
                  <Select id="headingFont" name="headingFont" defaultValue={b?.headingFont ?? 'serif'}>
                    <option value="serif">Elegant serif</option>
                    <option value="sans">Modern sans-serif</option>
                  </Select>
                </Field>
              </div>
              <BrandingPresetPicker
                initial={{
                  themePreset: b?.themePreset ?? 'classic',
                  primaryColor: b?.primaryColor ?? '#1F5C4A',
                  accentColor: b?.accentColor ?? '#B8975A',
                  backgroundColor: b?.backgroundColor ?? '#FBF7EE',
                  textColor: b?.textColor ?? '#1E2420',
                }}
                restaurantName={ctx.org.name}
              />
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
