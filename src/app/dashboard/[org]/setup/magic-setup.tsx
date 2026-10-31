'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Alert, Badge, Button, Field, Input } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { SOURCE_LABEL, type DiscoveryResult, type ProfileKey, type RestaurantProfile } from '@/server/discovery/types';
import { applyDiscoveryAction, discoverRestaurantAction } from './discovery-actions';

/** The fields shown on the review screen, in the order an owner reads them. */
const DETAIL_FIELDS = [
  { key: 'name', label: 'Restaurant name', required: true, placeholder: 'Casa de Marrocos' },
  { key: 'addressLine1', label: 'Street address', placeholder: 'R. de Santa Margarida 13' },
  { key: 'postalCode', label: 'Postal code', placeholder: '4710-311' },
  { key: 'city', label: 'City', placeholder: 'Braga' },
  { key: 'phone', label: 'Phone', placeholder: '+351 935 413 677', inputMode: 'tel' as const },
  { key: 'whatsappNumber', label: 'WhatsApp', placeholder: '+351 935 413 677', inputMode: 'tel' as const },
  { key: 'email', label: 'Email', placeholder: 'info@yourrestaurant.com', type: 'email' },
] as const;

const LINK_FIELDS = [
  { key: 'websiteUrl', label: 'Website' },
  { key: 'instagramUrl', label: 'Instagram' },
  { key: 'facebookUrl', label: 'Facebook' },
  { key: 'tiktokUrl', label: 'TikTok' },
  { key: 'glovoUrl', label: 'Glovo' },
  { key: 'uberEatsUrl', label: 'Uber Eats' },
  { key: 'googleReviewUrl', label: 'Google reviews' },
] as const;

const str = (p: RestaurantProfile, key: ProfileKey): string => {
  const v = p[key]?.value;
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 animate-spin" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Where a value came from, and what the other sources said, shown under its input. */
function SourceNote({ profile, field }: { profile: RestaurantProfile; field: ProfileKey }) {
  const found = profile[field];
  if (!found) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted" data-testid={`source-${field}`}>
      <span className="inline-flex items-center gap-1">
        <svg viewBox="0 0 16 16" className="size-3 text-success" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {SOURCE_LABEL[found.source]}
      </span>
      {found.alternatives?.map((a) => (
        <span key={`${a.source}`} className="text-warning">
          {SOURCE_LABEL[a.source]} says {typeof a.value === 'string' ? a.value : JSON.stringify(a.value)}
        </span>
      ))}
    </span>
  );
}

/**
 * Magic Restaurant Setup.
 *
 * Step one asks for whatever the owner already has — a Google Maps link, their website, or just
 * the name and city — and looks the restaurant up. Step two shows everything found with its
 * source, for the owner to correct, and saves it in one go.
 *
 * Nothing is saved by the lookup itself, and the form the owner submits is what gets written,
 * so a corrected or cleared field is always respected.
 */
export function MagicSetup({
  org,
  locationId,
  initial,
  startCollapsed = false,
}: {
  org: string;
  locationId: string;
  initial: { name: string; city: string | null; websiteUrl: string | null };
  /** Details are already filled in, so the lookup is offered as a way to refresh them. */
  startCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!startCollapsed);
  const [found, setFound] = useState<DiscoveryResult | null>(null);
  const [discoverState, discover, discovering] = useActionState(discoverRestaurantAction, initialActionState);
  const [applyState, apply, applying] = useActionState(applyDiscoveryAction, initialActionState);
  // Bumped on every lookup so the hours editor remounts with the newly found hours.
  const [hoursKey, setHoursKey] = useState(0);
  const reviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!discoverState.ok || !discoverState.data) return;
    setFound(discoverState.data as DiscoveryResult);
    setHoursKey((k) => k + 1);
    reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [discoverState]);

  const discoverError = !discoverState.ok && discoverState.error ? (discoverState.error === 'validation' ? 'Enter a Google Maps link, your website, or your restaurant name.' : friendlyError(discoverState.error)) : null;
  const applyError = !applyState.ok && applyState.error ? (applyState.error === 'validation' ? 'Some values need attention — check the highlighted fields.' : friendlyError(applyState.error)) : null;
  const fieldError = (k: string) => (!applyState.ok ? applyState.fieldErrors?.[k] : undefined);
  const profile = found?.profile ?? {};
  const filled = found ? Object.keys(found.profile).length : 0;

  if (applyState.ok && applyState.data) {
    return (
      <div className="space-y-3" data-testid="magic-setup-saved">
        <Alert tone="success" title="Your restaurant details are saved">
          Next: add your menu, then your tables. You can change any of this later in Settings.
        </Alert>
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          Look something up again
        </Button>
      </div>
    );
  }

  // Collapsed: a one-line way back in, in the same place in the tree.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 text-start transition-colors hover:bg-surface-2"
        data-testid="magic-setup-collapsed"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">✨ Find my restaurant again</span>
          <span className="block text-xs text-muted">Look your details up from Google Maps, your website or OpenStreetMap and compare them with what you have.</span>
        </span>
        <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-labelledby="magic-title">
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime text-xl" aria-hidden>
              ✨
            </span>
            <div className="min-w-0">
              <h2 id="magic-title" className="text-lg font-semibold tracking-tight text-ink">
                Find my restaurant
              </h2>
              <p className="mt-0.5 text-sm text-muted">Give us anything you already have and we fill in the rest. Nothing is saved until you review it.</p>
            </div>
          </div>

          <form onSubmit={keepValuesOnSubmit(discover)} className="mt-6 space-y-4" data-testid="discover-form">
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="locationId" value={locationId} />
            <Field label="Google Maps link" htmlFor="mapsUrl" hint="In Google Maps, open your restaurant and tap Share → Copy link.">
              <Input id="mapsUrl" name="mapsUrl" type="url" inputMode="url" spellCheck={false} placeholder="https://maps.app.goo.gl/…" data-testid="maps-url" />
            </Field>
            <Field label="Your website" htmlFor="websiteUrl" hint="The most complete source: your own site usually has your address, phone and hours.">
              <Input id="websiteUrl" name="websiteUrl" inputMode="url" spellCheck={false} defaultValue={initial.websiteUrl ?? ''} placeholder="casademarrocos.com" data-testid="website-url" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
              <Field label="Restaurant name" htmlFor="discover-name">
                <Input id="discover-name" name="name" defaultValue={initial.name} placeholder="Casa de Marrocos" data-testid="discover-name" />
              </Field>
              <Field label="City" htmlFor="discover-city">
                <Input id="discover-city" name="city" defaultValue={initial.city ?? ''} placeholder="Braga" data-testid="discover-city" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={discovering} data-testid="discover-button">
                {discovering ? (
                  <>
                    <Spinner /> Searching…
                  </>
                ) : (
                  'Find my restaurant'
                )}
              </Button>
              <span className="text-xs text-muted">Searches your website, Google Maps and OpenStreetMap.</span>
            </div>
            {discovering && (
              <p role="status" className="text-sm text-muted">
                Looking up your restaurant…
              </p>
            )}
            {discoverError && !discovering && (
              <div data-testid="discover-error">
                <Alert tone="danger">{discoverError}</Alert>
              </div>
            )}
          </form>
        </div>
      </section>

      {found && (
        <div ref={reviewRef} className="scroll-mt-4 space-y-4" data-testid="discovery-review">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Check what we found</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {filled} {filled === 1 ? 'detail' : 'details'} found. Correct anything that is wrong, then save.
                </p>
              </div>
              <Badge tone="lime">Nothing saved yet</Badge>
            </div>

            <ul className="divide-y divide-line text-sm" data-testid="source-reports">
              {found.reports.map((r) => (
                <li key={r.source} className="flex flex-wrap items-baseline gap-x-2 px-5 py-2" data-testid={`report-${r.source}`}>
                  <span
                    className={cn(
                      'inline-flex min-w-28 items-center gap-1.5 font-medium',
                      r.status === 'ok' ? 'text-success' : r.status === 'failed' ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {r.status === 'ok' ? '✓' : r.status === 'failed' ? '×' : '–'} {SOURCE_LABEL[r.source]}
                  </span>
                  <span className="text-muted">{r.detail}</span>
                </li>
              ))}
            </ul>

            <form onSubmit={keepValuesOnSubmit(apply)} className="space-y-5 p-5" data-testid="apply-form">
              <input type="hidden" name="org" value={org} />
              <input type="hidden" name="locationId" value={locationId} />
              {applyError && <Alert tone="danger">{applyError}</Alert>}

              <div className="grid gap-4 sm:grid-cols-2">
                {DETAIL_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label} htmlFor={`a-${f.key}`} error={fieldError(f.key)}>
                    <Input
                      id={`a-${f.key}`}
                      name={f.key}
                      type={'type' in f ? f.type : 'text'}
                      inputMode={'inputMode' in f ? f.inputMode : undefined}
                      required={'required' in f ? f.required : undefined}
                      defaultValue={str(profile, f.key)}
                      placeholder={f.placeholder}
                      data-testid={`field-${f.key}`}
                    />
                    <SourceNote profile={profile} field={f.key} />
                  </Field>
                ))}
              </div>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Opening hours</legend>
                {profile.openingHours ? (
                  <p className="mb-2 text-xs text-muted" data-testid="hours-source">
                    Read from {SOURCE_LABEL[profile.openingHours.source]}. Check every day before guests can order.
                  </p>
                ) : (
                  <p className="mb-2 text-xs text-muted">No hours were found. Add them here — takeaway and delivery cannot be switched on without them.</p>
                )}
                {/* The editor renders its own hidden `openingHours` field and manages its state. */}
                <OpeningHoursEditor key={hoursKey} name="openingHours" initial={profile.openingHours?.value ?? null} />
              </fieldset>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Links</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {LINK_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label} htmlFor={`a-${f.key}`} error={fieldError(f.key)}>
                      <Input id={`a-${f.key}`} name={f.key} inputMode="url" spellCheck={false} defaultValue={str(profile, f.key)} placeholder="https://" data-testid={`field-${f.key}`} />
                      <SourceNote profile={profile} field={f.key} />
                    </Field>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button type="submit" size="lg" disabled={applying} data-testid="apply-button">
                  {applying ? 'Saving…' : 'Save these details'}
                </Button>
                <span className="text-xs text-muted">Saves your restaurant details and links. Ordering channels stay off until you turn them on.</span>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
