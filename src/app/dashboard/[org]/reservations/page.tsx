import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Field, Input, Label, PageHeader, Select } from '@/components/ui';
import { getMessages } from '@/i18n';
import type { OpeningHours } from '@/lib/opening-hours';
import { formatTimeInZone, zonedParts } from '@/lib/time';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { reservationsForDay } from '@/server/services/reservations';
import { requireTenantPage } from '@/server/tenant';
import { assignTableAction, reservationStatusAction, saveReservationSettingsAction, unassignTableAction } from './actions';

const NEXT: Record<string, { to: string; label: string; variant: 'primary' | 'secondary' | 'ghost' | 'dark' }[]> = {
  REQUESTED: [{ to: 'CONFIRMED', label: 'Confirm', variant: 'primary' }, { to: 'REJECTED', label: 'Reject', variant: 'secondary' }],
  CONFIRMED: [{ to: 'ARRIVED', label: 'Arrived', variant: 'dark' }, { to: 'NO_SHOW', label: 'No-show', variant: 'secondary' }, { to: 'CANCELLED', label: 'Cancel', variant: 'ghost' }],
  ARRIVED: [{ to: 'COMPLETED', label: 'Completed', variant: 'secondary' }],
};
const TONE: Record<string, 'warning' | 'success' | 'info' | 'neutral' | 'danger'> = { REQUESTED: 'warning', CONFIRMED: 'success', ARRIVED: 'info', COMPLETED: 'neutral', REJECTED: 'danger', CANCELLED: 'neutral', NO_SHOW: 'danger' };

function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function ReservationsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ date?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'reservations.manage');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  const p = zonedParts(new Date(), location.timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const [list, tables, settings] = await Promise.all([
    reservationsForDay(ctx, location.id, date),
    db.restaurantTable.findMany({ where: { locationId: location.id, organizationId: ctx.org.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.reservationSettings.findUnique({ where: { locationId: location.id } }),
  ]);
  const base = `/dashboard/${ctx.org.slug}/reservations`;
  const covers = list.filter((r) => ['REQUESTED', 'CONFIRMED', 'ARRIVED'].includes(r.status)).reduce((n, r) => n + r.partySize, 0);
  return (
    <>
      <PageHeader
        title={m.nav.reservations}
        description="Guests request a time; you confirm. No SMS is sent — guests check their private status page."
        actions={
          <div className="flex items-center gap-2">
            <ButtonLink href={`${base}?date=${shift(date, -1)}`} variant="secondary" size="sm">←</ButtonLink>
            <form className="flex items-center gap-2"><Input type="date" name="date" defaultValue={date} className="h-8 w-40" aria-label="Date" /><button className="text-sm underline">Go</button></form>
            <ButtonLink href={`${base}?date=${shift(date, 1)}`} variant="secondary" size="sm">→</ButtonLink>
          </div>
        }
      />
      {!location.reservationsEnabled && <div className="mb-4"><Alert tone="warning">Reservations are switched off. Turn them on in <Link className="underline" href={`/dashboard/${ctx.org.slug}/settings/channels`}>Settings → Ordering channels</Link>.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader title={new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })} description={`${list.length} reservations · ${covers} guests expected`} />
          {list.length === 0 ? (
            <CardBody><EmptyState title="No reservations for this day" /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((r) => (
                <li key={r.id} className="space-y-2 px-5 py-4" data-testid="reservation-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums">{formatTimeInZone(r.startsAt, location.timeZone)}</span>
                    <span className="flex-1 font-medium">{r.name} · {r.partySize} guests</span>
                    <Badge tone={TONE[r.status]}>{r.status.toLowerCase().replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm text-muted">{r.phone}{r.email ? ` · ${r.email}` : ''}</p>
                  {r.specialRequest && <p className="text-sm text-warning">“{r.specialRequest}”</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.assignments.map((a) => (
                      <span key={a.id} className="flex items-center gap-1">
                        <Badge tone="dark" data-testid="assigned-table">Table {a.table.label}</Badge>
                        <InlineAction action={unassignTableAction} fields={{ org: ctx.org.slug, reservationId: r.id, tableId: a.table.id }} label="✕" variant="ghost" />
                      </span>
                    ))}
                    {['REQUESTED', 'CONFIRMED', 'ARRIVED'].includes(r.status) && tables.length > 0 && (
                      <ActionForm action={assignTableAction} submitLabel="Assign table" submitVariant="secondary" className="flex items-center gap-2 space-y-0">
                        <input type="hidden" name="org" value={ctx.org.slug} />
                        <input type="hidden" name="reservationId" value={r.id} />
                        <Select name="tableId" className="h-8 w-36" aria-label="Table" data-testid="reservation-table">
                          {tables.map((t) => <option key={t.id} value={t.id}>Table {t.label}{t.seats ? ` (${t.seats})` : ''}</option>)}
                        </Select>
                      </ActionForm>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(NEXT[r.status] ?? []).map((n) => (
                      <InlineAction key={n.to} action={reservationStatusAction} fields={{ org: ctx.org.slug, reservationId: r.id, to: n.to, expectedFrom: r.status }} label={n.label} variant={n.variant} testId={`res-${n.to}`} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {ctx.can('settings.manage') && (
          <Card>
            <CardHeader title="Reservation settings" />
            <CardBody>
              <ActionForm action={saveReservationSettingsAction} testId="reservation-settings-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="locationId" value={location.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Time step" htmlFor="rs-slot">
                    <Select id="rs-slot" name="slotMinutes" defaultValue={String(settings?.slotMinutes ?? 30)}>{[15, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</Select>
                  </Field>
                  <Field label="Visit length (min)" htmlFor="rs-dur"><Input id="rs-dur" name="durationMinutes" type="number" defaultValue={settings?.durationMinutes ?? 90} /></Field>
                  <Field label="Table buffer (min)" htmlFor="rs-buf"><Input id="rs-buf" name="bufferMinutes" type="number" defaultValue={settings?.bufferMinutes ?? 15} /></Field>
                  <Field label="Max party size" htmlFor="rs-party"><Input id="rs-party" name="maxPartySize" type="number" defaultValue={settings?.maxPartySize ?? 8} /></Field>
                  <Field label="Max guests at once" htmlFor="rs-cap"><Input id="rs-cap" name="maxCoversPerSlot" type="number" defaultValue={settings?.maxCoversPerSlot ?? 20} /></Field>
                  <Field label="Min notice (min)" htmlFor="rs-notice"><Input id="rs-notice" name="minNoticeMinutes" type="number" defaultValue={settings?.minNoticeMinutes ?? 60} /></Field>
                  <Field label="Book up to (days ahead)" htmlFor="rs-days"><Input id="rs-days" name="maxDaysAhead" type="number" defaultValue={settings?.maxDaysAhead ?? 60} /></Field>
                </div>
                <div>
                  <Label>Bookable hours</Label>
                  <p className="mb-2 text-xs text-muted">Leave empty to use opening hours. Without any hours, guests cannot book online.</p>
                  <OpeningHoursEditor name="bookableHours" initial={(settings?.bookableHours as OpeningHours | null) ?? null} />
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
