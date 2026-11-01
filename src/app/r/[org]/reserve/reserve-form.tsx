'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { FloorPlan } from '@/components/storefront/floor-plan';
import type { LanguageCode } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt, LANGUAGE_TAG } from '@/i18n/config';
import { cn } from '@/lib/cn';
import type { PlanArea, PlanTable, TableStatus } from '@/lib/floor-plan';
import { uuid } from '@/lib/uuid';

type Slot = { time: string; available: boolean };
/** Times for the first date and party size, computed by the server with the page. */
export type InitialSlots = { date: string; party: number; slots: Slot[]; reason: string };
/** Tables the guest may choose from: drawn on dining areas, or (not placed yet) as a list. */
export type GuestPlan = { areas: PlanArea[]; unplaced: Omit<PlanTable, 'x' | 'y'>[] };

const card = 'rounded-2xl bg-sf-card/90 p-4 shadow-sm ring-1 ring-sf-text/8 sm:p-5';
const input = 'h-11 w-full rounded-xl border border-sf-text/10 bg-sf-card px-3 text-base';

export function ReserveForm({
  org,
  l,
  lang,
  today,
  maxParty,
  initial,
  sendingLabel,
  plan = null,
  preview = false,
  m,
}: {
  org: string;
  l?: string;
  lang: LanguageCode;
  today: string;
  maxParty: number;
  initial: InitialSlots;
  sendingLabel: string;
  /** Present when the restaurant lets guests choose their table. */
  plan?: GuestPlan | null;
  /** Draft preview by a member: the public endpoints answer for the unpublished location too. */
  preview?: boolean;
  m: Pick<Messages, 'reservation' | 'validation' | 'common'>;
}) {
  const r = m.reservation;
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [party, setParty] = useState(initial.party);
  // The first times arrive with the page: nothing below them moves while the guest starts filling
  // the form, and slow connections skip one round trip. Later choices fetch their own times.
  const [slots, setSlots] = useState<Slot[]>(initial.slots);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [reason, setReason] = useState(initial.reason);
  const [slotsFor, setSlotsFor] = useState(`${initial.date}|${initial.party}`);
  const [time, setTime] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', specialRequest: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(uuid);
  // Table choice (floor plan). Availability depends on the time, so it is fetched once one is chosen.
  const hasPlan = !!plan && (plan.areas.length > 0 || plan.unplaced.length > 0);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tables, setTables] = useState<{ key: string; status: Record<string, TableStatus> } | null>(null);
  const [tablesNonce, setTablesNonce] = useState(0);
  const [tablesFailed, setTablesFailed] = useState('');
  const [tableNotice, setTableNotice] = useState<string | null>(null);
  // Statuses count only for the date, party and time they were fetched for (null = not known yet).
  const tablesKey = hasPlan && time ? `${date}|${party}|${time}` : '';
  const tableStatus = tables && tablesKey && tables.key === tablesKey ? tables.status : null;
  const tablesError = !!tablesKey && tablesFailed === `${tablesKey}#${tablesNonce}`;
  const [planOpen, setPlanOpen] = useState(false);
  const scope = `org=${encodeURIComponent(org)}${l ? `&l=${encodeURIComponent(l)}` : ''}${preview ? '&preview=1' : ''}`;
  const allTables = [...(plan?.areas.flatMap((a) => a.tables.map((t) => ({ ...t, area: a.name }))) ?? []), ...(plan?.unplaced.map((t) => ({ ...t, area: null })) ?? [])];
  const chosen = allTables.find((t) => t.id === tableId) ?? null;
  const formRef = useRef<HTMLFormElement>(null);

  // On a slow phone the form is on screen before its script runs. Whatever the guest already
  // chose or typed then is still in the fields: adopt it, so the times, the tables and the request
  // match what the guest sees (otherwise today's times would be shown under tomorrow's date).
  const adoptEarlyInput = useEffectEvent(() => {
    const el = formRef.current;
    if (!el) return;
    const value = (field: string) => el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${field}"]`)?.value ?? '';
    const d = value('date');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d !== date) setDate(d);
    const n = Number(value('party'));
    if (Number.isInteger(n) && n >= 1 && n <= maxParty && n !== party) setParty(n);
    const typed = { name: value('name'), phone: value('phone'), email: value('email'), specialRequest: value('specialRequest').slice(0, 500) };
    if (Object.values(typed).some(Boolean)) setForm((cur) => ({ name: typed.name || cur.name, phone: typed.phone || cur.phone, email: typed.email || cur.email, specialRequest: typed.specialRequest || cur.specialRequest }));
  });
  useEffect(() => adoptEarlyInput(), []);

  useEffect(() => {
    const wanted = `${date}|${party}`;
    if (wanted === slotsFor) return;
    // The previous times stay on screen, dimmed, until the new ones arrive: the form below does
    // not jump on a slow connection.
    setLoadingSlots(true);
    setSlotsFailed(false);
    setTime('');
    const ctrl = new AbortController();
    fetch(`/api/public/reservations/slots?${scope}&date=${date}&party=${party}`, { signal: ctrl.signal })
      .then((x) => x.json())
      .then((d) => {
        setSlots(d.slots ?? []);
        setReason(d.reason ?? 'ok');
        setSlotsFor(wanted);
        setLoadingSlots(false);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setSlots([]);
        setSlotsFailed(true);
        setLoadingSlots(false);
      });
    return () => ctrl.abort();
  }, [scope, date, party, slotsFor]);

  const tablesArrived = useEffectEvent((key: string, status: Record<string, TableStatus>) => {
    setTables({ key, status });
    // A table chosen for another time or party may not fit this one: never keep it silently.
    if (tableId && status[tableId] !== 'available') {
      setTableId(null);
      setTableNotice(r.tableTaken);
    }
  });
  useEffect(() => {
    if (!tablesKey) return;
    const ctrl = new AbortController();
    fetch(`/api/public/reservations/tables?${scope}&date=${date}&party=${party}&time=${time}`, { signal: ctrl.signal })
      .then((x) => x.json())
      // A table missing from the answer (or an error answer) counts as taken, never as free.
      .then((d: { tables?: { id: string; status: TableStatus }[] }) => tablesArrived(tablesKey, Object.fromEntries((d.tables ?? []).map((t) => [t.id, t.status]))))
      .catch(() => {
        if (!ctrl.signal.aborted) setTablesFailed(`${tablesKey}#${tablesNonce}`);
      });
    return () => ctrl.abort();
  }, [tablesKey, scope, date, party, time, tablesNonce]);

  const choose = (id: string | null) => {
    setTableId(id);
    setTableNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!time) return setError(r.chooseTime);
    setBusy(true);
    try {
      const res = await fetch('/api/public/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: org, locationSlug: l, date, time, partySize: party, ...form, idempotencyKey: key, language: lang, ...(tableId ? { tableId } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.token) return router.push(`/reservation/${d.token}`);
      if (d.error === 'table_unavailable') {
        // Someone took it a moment ago: show the fresh plan and let the guest choose again.
        setTableId(null);
        setTableNotice(r.tableTaken);
        setTables(null);
        setTablesNonce((n) => n + 1);
      } else setError(d.error === 'table_too_small' ? r.tableTooSmallError : d.error === 'slot_unavailable' ? r.invalidTime : d.error === 'validation_failed' ? m.validation.required : r.noAvailability);
    } catch {
      setError(m.common.connectionLost);
    }
    setBusy(false);
  };

  const dateLabel = new Intl.DateTimeFormat(LANGUAGE_TAG[lang], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const freeNow = tableStatus ? Object.values(tableStatus).filter((s) => s === 'available').length : null;
  const planLabels = { floorPlan: r.floorPlan, tableAvailable: r.tableAvailable, tableSelected: r.tableSelected, tableUnavailable: r.tableUnavailable, tableTooSmall: r.tableTooSmall, tableNotBookable: r.tableNotBookable, seats: r.seats, tableLabel: r.tableLabel, pickTimeFirst: r.pickTimeFirst };

  return (
    <form ref={formRef} onSubmit={submit} className={cn('grid gap-4 sm:gap-5', hasPlan && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start lg:gap-6')} data-testid="reserve-form" data-has-plan={hasPlan || undefined}>
      <section className={cn(card, 'space-y-4', hasPlan && 'lg:col-start-1 lg:row-start-1')}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{r.date}</span>
            <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={input} data-field="date" data-testid="reserve-date" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{r.partySize}</span>
            <select value={party} onChange={(e) => setParty(Number(e.target.value))} className={input} data-field="party" data-testid="reserve-party">
              {Array.from({ length: maxParty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs opacity-70">{fmt(r.maxPartySize, { n: maxParty })}</p>
        <fieldset aria-busy={loadingSlots} className={cn('transition-opacity', loadingSlots && 'pointer-events-none opacity-50')} data-testid="reserve-times" data-for={slotsFor}>
          <legend className="mb-2 text-sm font-medium">
            {r.time}
            {loadingSlots && (
              <span className="ms-2 text-xs font-normal opacity-70" role="status">
                {m.common.loading}
              </span>
            )}
          </legend>
          {slotsFailed ? (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
              {m.common.connectionLost}
              <button type="button" className="font-medium underline" onClick={() => setSlotsFor('')}>
                {m.common.retry}
              </button>
            </p>
          ) : reason === 'hours_not_configured' ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{r.hoursNotSet}</p>
          ) : reason === 'date_out_of_range' ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{r.dateTooFar}</p>
          ) : slots.filter((s) => s.available).length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="no-slots">
              {r.noAvailability}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  disabled={!s.available || loadingSlots}
                  aria-pressed={time === s.time}
                  onClick={() => setTime(s.time)}
                  className={cn('h-10 rounded-xl text-sm tabular-nums ring-1 transition-colors', time === s.time ? 'bg-sf-primary text-sf-on-primary ring-sf-primary' : 'bg-sf-card ring-sf-text/10 hover:ring-sf-primary/50', !s.available && 'line-through opacity-40')}
                  data-testid="reserve-slot"
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      </section>

      {hasPlan && plan && (
        <section className={cn(card, 'space-y-3 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1')} data-testid="table-choice" aria-labelledby="table-choice-title">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="table-choice-title" className="font-semibold">
                {r.chooseTable}
              </h3>
              <p className="text-xs opacity-70">{r.tableOptional}</p>
            </div>
            <button type="button" className="inline-flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm font-medium text-sf-primary-ink ring-1 ring-sf-primary/40 lg:hidden" aria-expanded={planOpen} aria-controls="table-choice-plan" onClick={() => setPlanOpen((o) => !o)} data-testid="toggle-plan">
              {planOpen ? r.hidePlan : r.showPlan}
            </button>
          </div>
          <button
            type="button"
            aria-pressed={tableId === null}
            onClick={() => choose(null)}
            className={cn('flex w-full items-start gap-3 rounded-xl p-3 text-start ring-1 transition-colors', tableId === null ? 'bg-sf-primary/8 ring-sf-primary' : 'ring-sf-text/10 hover:ring-sf-text/25')}
            data-testid="any-table"
          >
            <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2', tableId === null ? 'border-sf-primary' : 'border-sf-text/30')} aria-hidden>
              {tableId === null && <span className="size-2.5 rounded-full bg-sf-primary" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{r.anyTable}</span>
              <span className="block text-xs opacity-70">{r.anyTableHint}</span>
            </span>
          </button>
          {chosen && (
            <p className="flex items-center gap-2 rounded-xl bg-sf-primary px-3 py-2 text-sm font-medium text-sf-on-primary" data-testid="chosen-table">
              {fmt(r.tableLabel, { label: chosen.label })}
              {chosen.seats ? ` · ${fmt(r.seats, { n: chosen.seats })}` : ''}
              {chosen.area ? ` · ${chosen.area}` : ''}
            </p>
          )}
          {tableNotice && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="table-notice">
              {tableNotice}
            </p>
          )}
          <div id="table-choice-plan" className={cn('space-y-3', planOpen ? 'block' : 'hidden', 'lg:block')}>
            {!time ? (
              <p className="rounded-xl bg-sf-text/5 px-3 py-2 text-sm opacity-80" data-testid="plan-hint">
                {r.pickTimeFirst}
              </p>
            ) : tablesError ? (
              <p className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
                {m.common.connectionLost}
                <button type="button" className="font-medium underline" onClick={() => setTablesNonce((n) => n + 1)}>
                  {m.common.retry}
                </button>
              </p>
            ) : !tableStatus ? (
              <p className="px-1 text-xs opacity-70" role="status" data-testid="plan-loading">
                {m.common.loading}
              </p>
            ) : (
              freeNow === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{r.noTablesFree}</p>
            )}
            {plan.areas.length > 0 && <FloorPlan areas={plan.areas} status={tableStatus} selectedId={tableId} onSelect={choose} labels={planLabels} disabled={preview} />}
            {plan.unplaced.length > 0 && (
              // Tables not drawn on a plan yet: the same choice as a simple list.
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={r.chooseTable}>
                {plan.unplaced.map((t) => {
                  const st = tableStatus?.[t.id];
                  const can = !preview && st === 'available';
                  const sel = t.id === tableId;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-pressed={sel}
                        disabled={!can && !sel}
                        onClick={() => choose(sel ? null : t.id)}
                        className={cn('flex w-full flex-col items-start rounded-xl p-3 text-start ring-1 transition-colors', sel ? 'bg-sf-primary text-sf-on-primary ring-sf-primary' : can ? 'bg-sf-card ring-sf-primary/50 hover:ring-sf-primary' : 'bg-sf-text/5 opacity-55 ring-sf-text/10')}
                        data-testid="plan-table"
                        data-table={t.label}
                        data-status={sel ? 'selected' : (st ?? 'unknown')}
                      >
                        <span className="text-sm font-semibold">{fmt(r.tableLabel, { label: t.label })}</span>
                        <span className="text-xs opacity-75">
                          {t.seats ? fmt(r.seats, { n: t.seats }) : r.tableNotBookable}
                          {st && !sel && st !== 'available' ? ` · ${{ booked: r.tableUnavailable, too_small: r.tableTooSmall, not_bookable: r.tableNotBookable }[st]}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className={cn(card, 'space-y-3', hasPlan && 'lg:col-start-1 lg:row-start-2')}>
        <input required placeholder={r.name} aria-label={r.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} maxLength={80} autoComplete="name" data-field="name" />
        <input required type="tel" placeholder={r.phone} aria-label={r.phone} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} maxLength={20} autoComplete="tel" data-field="phone" />
        <input type="email" placeholder={`${r.email} (${m.common.optional})`} aria-label={r.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} autoComplete="email" data-field="email" />
        <textarea placeholder={`${r.specialRequest} (${m.common.optional})`} aria-label={r.specialRequest} value={form.specialRequest} onChange={(e) => setForm({ ...form, specialRequest: e.target.value.slice(0, 500) })} className="min-h-[70px] w-full rounded-xl border border-sf-text/10 bg-sf-card p-3 text-base" data-field="specialRequest" />
        {/* What will be requested, in plain words, before the guest sends it. */}
        <div className="rounded-xl bg-sf-text/5 p-3 text-sm" data-testid="reserve-summary">
          <p className="mb-1.5 font-semibold">{r.summary}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="opacity-70">{r.date}</dt>
            <dd className="font-medium">{dateLabel}</dd>
            <dt className="opacity-70">{r.time}</dt>
            <dd className="font-medium tabular-nums">{time || r.notChosen}</dd>
            <dt className="opacity-70">{r.partySize}</dt>
            <dd className="font-medium">{fmt(r.guests, { n: party })}</dd>
            {hasPlan && (
              <>
                <dt className="opacity-70">{r.table}</dt>
                <dd className="font-medium" data-testid="summary-table">
                  {chosen ? fmt(r.tableLabel, { label: chosen.label }) : r.anyTable}
                </dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-xs opacity-75">{r.requestNote}</p>
        </div>
        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="h-12 w-full rounded-2xl bg-sf-primary font-medium text-sf-on-primary disabled:opacity-50" data-testid="reserve-submit">
          {busy ? sendingLabel : r.submit}
        </button>
        <p className="text-xs opacity-70">{r.keepPage}</p>
      </section>
    </form>
  );
}
