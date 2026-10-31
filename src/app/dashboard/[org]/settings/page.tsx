import { ActionForm, FieldError } from '@/components/forms/action-form';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Card, CardBody, Checkbox, Field, Icon, Input, Label, PageHeader, Section, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { LANGUAGE_NATIVE_NAME, LANGUAGES } from '@/i18n/config';
import type { OpeningHours } from '@/lib/opening-hours';
import { db } from '@/server/db';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { saveLocationDetailsAction, saveOrganizationSettingsAction } from './actions';
import { createLocationAction } from '../menu/actions';
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
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="details" locationId={location?.id} />
      <PageHeader title="Restaurant settings" description="Information entered here is shown to your guests. Nothing is filled in automatically." />
      <SettingsTabs base={base} active="details" />
      <div className="max-w-5xl">
        <Section title="Restaurant & languages" description="Your restaurant's name and tax details, and the languages guests can read the menu in.">
        <Card>
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
        </Section>

        {location && (
          <Section
            title={`Location: ${location.name}`}
            description={locations.length > 1 ? 'Address, contact and opening hours shown to guests. Choose the location to edit above the form.' : 'Address, contact and opening hours shown to guests.'}
          >
          <Card>
            <CardBody>
              {locations.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Location">
                  {locations.map((l) => (
                    <a
                      key={l.id}
                      href={`?location=${l.id}`}
                      aria-current={l.id === location.id ? 'true' : undefined}
                      className={cn(
                        'inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium pointer-coarse:min-h-10',
                        l.id === location.id ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                      )}
                    >
                      <Icon name="map" className="size-3.5" />
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
          </Section>
        )}
      {ctx.role === 'RESTAURANT_OWNER' && (
        <Section title="Locations" description={`${locations.length} location${locations.length > 1 ? 's' : ''}. Each location has its own address, hours, tables, stations and publishing. Your plan sets how many you can add.`}>
        <Card>
          <CardBody>
            <ActionForm action={createLocationAction} submitLabel="Add location" resetOnSuccess className="grid items-end gap-3 space-y-0 sm:grid-cols-[1fr_1fr_auto]" testId="add-location-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="Location name" htmlFor="newloc"><Input id="newloc" name="name" required /></Field>
              <Field label="City" htmlFor="newcity" optionalLabel="optional"><Input id="newcity" name="city" /></Field>
            </ActionForm>
          </CardBody>
        </Card>
        </Section>
      )}
      </div>
    </>
  );
}
