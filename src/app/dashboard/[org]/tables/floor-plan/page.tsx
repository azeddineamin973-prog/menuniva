import type { CSSProperties } from 'react';
import { LocationSwitcher } from '@/components/dashboard/location-switcher';
import { Alert, ButtonLink, Icon, PageHeader } from '@/components/ui';
import { paletteVars, storefrontPalette } from '@/lib/color';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { floorPlanForEditor } from '@/server/services/floor-plan';
import { tableAssignmentMode } from '@/server/services/reservations';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { TableAssignmentForm } from './assignment-form';
import { FloorPlanEditor } from './floor-plan-editor';

/**
 * Floor plan builder of one location: each restaurant draws its own rooms (size, labels) and
 * places the tables it has; optionally guests choose a free table on it when they book.
 */
export default async function FloorPlanPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const [location, locations] = await Promise.all([currentLocation(ctx), accessibleLocations(ctx)]);
  if (!location) return <Alert tone="warning">No location yet.</Alert>;
  const [plan, branding, modules] = await Promise.all([floorPlanForEditor(ctx, location.id), db.restaurantBranding.findUnique({ where: { organizationId: ctx.org.id } }), orgModules(ctx.org.id)]);
  const base = `/dashboard/${ctx.org.slug}`;
  const reservations = modules.has('reservations');
  const mode = tableAssignmentMode(plan);
  const areaIds = new Set(plan.areas.map((a) => a.id));
  const placed = plan.tables.filter((t) => t.areaId && areaIds.has(t.areaId) && t.planX !== null && t.planY !== null);
  const drawnAreas = new Set(placed.map((t) => t.areaId)).size;
  const palette = storefrontPalette(branding);
  const guestStyle = { ...paletteVars(palette), background: palette.bg } as CSSProperties;
  // What a guest booking at this location sees right now, in plain words.
  const guestSees = !location.reservationsEnabled
    ? 'Online reservations are switched off for this location (Settings → Ordering channels).'
    : mode !== 'guest'
      ? `The simple booking form (date, time, party size).${mode === 'automatic' ? ' Each request holds a free table automatically.' : ''}`
      : placed.length
        ? `The floor plan: ${drawnAreas} area${drawnAreas === 1 ? '' : 's'}, ${placed.length} table${placed.length === 1 ? '' : 's'}, with the ones free at the chosen time.`
        : 'The booking form with a list of your tables, until you place tables on a plan.';
  return (
    <>
      <PageHeader
        title="Floor plan"
        description="Draw your own rooms and place your tables. Optionally, guests pick a free table when they request a reservation; you still confirm every request."
        meta={locations.length > 1 && <LocationSwitcher orgSlug={ctx.org.slug} current={location.id} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/tables`} variant="secondary" icon="tables">
              Tables
            </ButtonLink>
            {reservations && (
              <ButtonLink href={`${base}/preview?page=reserve`} variant="secondary" icon="eye" data-testid="preview-guest-plan">
                Preview booking page
              </ButtonLink>
            )}
          </div>
        }
      />
      {locations.length > 1 && (
        <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-muted" data-testid="floor-plan-location">
          <Icon name="map" className="size-3.5" /> Each location has its own floor plan. You are editing <span className="font-medium text-ink">{location.name}</span>.
        </p>
      )}
      {reservations && (
        <section className="mb-5 space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-labelledby="assignment-title" data-testid="booking-mode">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="assignment-title" className="text-sm font-semibold text-ink">
              Online bookings and tables
            </h2>
            <p className="text-xs text-muted" data-testid="guest-sees">
              <span className="font-medium text-ink-2">Guests see:</span> {guestSees}
            </p>
          </div>
          {ctx.can('settings.manage') ? (
            <TableAssignmentForm org={ctx.org.slug} locationId={location.id} mode={mode} autoFallback={plan.autoAssignTables} />
          ) : (
            <p className="text-sm text-ink-2">{{ staff: 'Staff assign tables to requests.', automatic: 'Tables are assigned automatically.', guest: 'Guests choose their table on the floor plan.' }[mode]}</p>
          )}
        </section>
      )}
      <FloorPlanEditor org={ctx.org.slug} locationId={location.id} areas={plan.areas} tables={plan.tables} canEdit={ctx.can('tables.manage')} guestStyle={guestStyle} guestMap={reservations && mode === 'guest'} />
    </>
  );
}
