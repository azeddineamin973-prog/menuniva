import { ActionForm, FieldError } from '@/components/forms/action-form';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, Label, PageHeader, Select } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGES } from '@/i18n/config';
import type { OpeningHours } from '@/lib/opening-hours';
import { db } from '@/server/db';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { saveLocationDetailsAction, saveOrganizationSettingsAction } from './actions';
import { SettingsTabs } from './tabs';

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ location?: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const organization = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const locations = await accessibleLocations(ctx);
  const { location: locationParam } = await searchParams;
  const location = locations.find((l) => l.id === locationParam) ?? locations[0];
  const base = `/dashboard/${ctx.org.slug}`;

  return (
    <>
      <PageHeader title="Restaurant settings" description="Information entered here is shown to your guests. Nothing is filled in automatically." />
      <SettingsTabs base={base} active="details" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Restaurant & languages" description="Customer menus are available in the languages you enable." />
          <CardBody>
            <ActionForm action={saveOrganizationSettingsAction} testId="org-settings-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="Restaurant name" htmlFor="name">
                <Input id="name" name="name" defaultValue={organization.name} required />
                <FieldError name="name" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name" htmlFor="legalName" optionalLabel="optional">
                  <Input id="legalName" name="legalName" defaultValue={organization.legalName ?? ''} />
                </Field>
                <Field label={organization.country === 'PT' ? 'NIF / NIPC' : 'NIF / CIF'} htmlFor="taxId" optionalLabel="optional">
                  <Input id="taxId" name="taxId" defaultValue={organization.taxId ?? ''} />
                </Field>
              </div>
              <Field label="Country" htmlFor="country">
                <Select id="country" name="country" defaultValue={organization.country}>
                  <option value="PT">Portugal</option>
                  <option value="ES">España</option>
                </Select>
              </Field>
              <div>
                <Label>Enabled customer languages</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {LANGUAGES.map((l) => (
                    <Checkbox key={l} name="enabledLanguages" value={l} label={LANGUAGE_NATIVE_NAME[l]} defaultChecked={organization.enabledLanguages.includes(l)} />
                  ))}
                </div>
                <FieldError name="enabledLanguages" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default language" htmlFor="defaultLanguage" hint="Shown first when a guest opens the menu.">
                  <Select id="defaultLanguage" name="defaultLanguage" defaultValue={organization.defaultLanguage}>
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>{LANGUAGE_NATIVE_NAME[l]}</option>
                    ))}
                  </Select>
                  <FieldError name="defaultLanguage" />
                </Field>
                <Field label="Source language" htmlFor="sourceLanguage" hint="The language you write your menu in.">
                  <Select id="sourceLanguage" name="sourceLanguage" defaultValue={organization.sourceLanguage}>
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>{LANGUAGE_NATIVE_NAME[l]}</option>
                    ))}
                  </Select>
                  <FieldError name="sourceLanguage" />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        {location && (
          <Card>
            <CardHeader
              title={`Location: ${location.name}`}
              description={locations.length > 1 ? 'Choose another location in the list below.' : 'Address, contact and opening hours shown to guests.'}
            />
            <CardBody>
              {locations.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {locations.map((l) => (
                    <a key={l.id} href={`?location=${l.id}`} className={`rounded-full border px-3 py-1 text-sm ${l.id === location.id ? 'border-graphite bg-graphite text-white' : 'border-line'}`}>
                      {l.name}
                    </a>
                  ))}
                </div>
              )}
              <ActionForm action={saveLocationDetailsAction} testId="location-settings-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="locationId" value={location.id} />
                <Field label="Location name" htmlFor="lname">
                  <Input id="lname" name="name" defaultValue={location.name} required />
                </Field>
                <Field label="Street address" htmlFor="addressLine1">
                  <Input id="addressLine1" name="addressLine1" defaultValue={location.addressLine1 ?? ''} />
                </Field>
                <Field label="Address line 2" htmlFor="addressLine2" optionalLabel="optional">
                  <Input id="addressLine2" name="addressLine2" defaultValue={location.addressLine2 ?? ''} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Postal code" htmlFor="postalCode" hint={location.country === 'PT' ? 'Format 0000-000' : 'Format 00000'}>
                    <Input id="postalCode" name="postalCode" defaultValue={location.postalCode ?? ''} />
                    <FieldError name="postalCode" />
                  </Field>
                  <Field label="City" htmlFor="city">
                    <Input id="city" name="city" defaultValue={location.city ?? ''} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Telephone" htmlFor="phone">
                    <Input id="phone" name="phone" type="tel" defaultValue={location.phone ?? ''} />
                    <FieldError name="phone" />
                  </Field>
                  <Field label="WhatsApp number" htmlFor="whatsappNumber">
                    <Input id="whatsappNumber" name="whatsappNumber" type="tel" defaultValue={location.whatsappNumber ?? ''} />
                    <FieldError name="whatsappNumber" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Email" htmlFor="lemail" optionalLabel="optional">
                    <Input id="lemail" name="email" type="email" defaultValue={location.email ?? ''} />
                    <FieldError name="email" />
                  </Field>
                  <Field label="Time zone" htmlFor="timeZone">
                    <Select id="timeZone" name="timeZone" defaultValue={location.timeZone}>
                      <option value="Europe/Lisbon">Europe/Lisbon (Portugal mainland)</option>
                      <option value="Atlantic/Madeira">Atlantic/Madeira</option>
                      <option value="Atlantic/Azores">Atlantic/Azores</option>
                      <option value="Europe/Madrid">Europe/Madrid (Spain mainland)</option>
                      <option value="Atlantic/Canary">Atlantic/Canary</option>
                    </Select>
                  </Field>
                </div>
                <div>
                  <Label>Opening hours</Label>
                  <OpeningHoursEditor name="openingHours" initial={(location.openingHours as OpeningHours | null) ?? null} />
                  <FieldError name="openingHours" />
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
