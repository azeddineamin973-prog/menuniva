import { ActionForm } from '@/components/forms/action-form';
import { env } from '@/server/env';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { saveBrandingAction } from '../actions';
import { SettingsTabs } from '../tabs';
import { BrandingPresetPicker } from './preset-picker';
import { MediaImage } from '@/components/ui/media-image';

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
        <CardHeader title="Customer menu style" />
        <CardBody>
          <ActionForm action={saveBrandingAction} testId="branding-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label="Logo" htmlFor="logo" hint="PNG, JPEG or WebP, up to 5 MB. Square logos look best.">
                  {b?.logoUrl && <MediaImage src={b.logoUrl} alt="Current logo" sizes="64px" widths={[160, 320]} className="mb-2 h-16 w-16 rounded-xl border border-line object-contain" width={64} height={64} />}
                  <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" data-max-bytes={env.UPLOAD_MAX_BYTES} className="pt-2" />
                  {b?.logoUrl && <Checkbox name="removeLogo" label="Remove the current logo" />}
                </Field>
                <Field label="Cover photo" htmlFor="cover" hint="Wide photo of your restaurant. Only upload photos you have the right to publish.">
                  {b?.coverUrl && <MediaImage src={b.coverUrl} alt="Current cover" sizes="(min-width: 1024px) 480px, 90vw" widths={[480, 640, 960, 1280]} className="mb-2 h-24 w-full rounded-xl border border-line object-cover" />}
                  <Input id="cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp" data-max-bytes={env.UPLOAD_MAX_BYTES} className="pt-2" />
                  {b?.coverUrl && <Checkbox name="removeCover" label="Remove the current cover photo" />}
                </Field>
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
