import type { CSSProperties } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, ButtonLink, Checkbox, PageHeader } from '@/components/ui';
import { paletteVars, storefrontPalette } from '@/lib/color';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { floorPlanForEditor } from '@/server/services/floor-plan';
import { requireTenantPage } from '@/server/tenant';
import { guestTableChoiceAction } from '../../reservations/actions';
import { FloorPlanEditor } from './floor-plan-editor';

/** Owner floor plan: the restaurant's existing tables arranged per dining area, optionally shown to guests. */
export default async function FloorPlanPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location yet.</Alert>;
  const [plan, branding, modules] = await Promise.all([floorPlanForEditor(ctx, location.id), db.restaurantBranding.findUnique({ where: { organizationId: ctx.org.id } }), orgModules(ctx.org.id)]);
  const base = `/dashboard/${ctx.org.slug}`;
  const reservations = modules.has('reservations');
  const placed = plan.tables.filter((t) => t.areaId && t.planX !== null && t.planY !== null).length;
  const guestStyle = { ...paletteVars(storefrontPalette(branding)), background: storefrontPalette(branding).bg } as CSSProperties;
  return (
    <>
      <PageHeader
        title="Floor plan"
        description="Arrange your tables as they stand in the restaurant. Optionally, guests pick a free table when they request a reservation; you still confirm every request."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/tables`} variant="secondary" icon="tables">
              Tables
            </ButtonLink>
            {reservations && (
              <ButtonLink href={`${base}/preview?page=reserve`} variant="secondary" icon="eye" data-testid="preview-guest-plan">
                Preview as guest
              </ButtonLink>
            )}
          </div>
        }
      />
      {reservations && ctx.can('settings.manage') && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Guests choose their table</p>
            <p className="text-xs text-muted">
              {plan.guestTableChoice ? 'On: the booking page shows this plan with the tables free at the chosen time.' : 'Off: guests choose only a time; you assign tables yourself.'} {placed === 0 && 'Place tables on a plan first (until then guests see a simple list).'}
            </p>
          </div>
          <ActionForm action={guestTableChoiceAction} submitLabel="Save" submitVariant="secondary" className="flex flex-wrap items-center gap-3 space-y-0" testId="guest-table-choice-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <Checkbox name="enabled" label="Show to guests" defaultChecked={plan.guestTableChoice} data-testid="guest-table-choice" />
          </ActionForm>
        </div>
      )}
      <FloorPlanEditor org={ctx.org.slug} locationId={location.id} areas={plan.areas} tables={plan.tables} canEdit={ctx.can('tables.manage')} guestStyle={guestStyle} />
    </>
  );
}
