'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { uuid } from '@/lib/uuid';

type Slot = { time: string; available: boolean };
/** Times for the first date and party size, computed by the server with the page. */
export type InitialSlots = { date: string; party: number; slots: Slot[]; reason: string };

export function ReserveForm({ org, l, lang, today, maxParty, initial, sendingLabel, m }: { org: string; l?: string; lang: LanguageCode; today: string; maxParty: number; initial: InitialSlots; sendingLabel: string; m: Pick<Messages, 'reservation' | 'validation' | 'common'> }) {
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

  useEffect(() => {
    const wanted = `${date}|${party}`;
    if (wanted === slotsFor) return;
    // The previous times stay on screen, dimmed, until the new ones arrive: the form below does
    // not jump on a slow connection.
    setLoadingSlots(true);
    setSlotsFailed(false);
    setTime('');
    const ctrl = new AbortController();
    fetch(`/api/public/reservations/slots?org=${encodeURIComponent(org)}${l ? `&l=${encodeURIComponent(l)}` : ''}&date=${date}&party=${party}`, { signal: ctrl.signal })
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
  }, [org, l, date, party, slotsFor]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!time) return setError(r.chooseTime);
    setBusy(true);
    try {
      const res = await fetch('/api/public/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: org, locationSlug: l, date, time, partySize: party, ...form, idempotencyKey: key, language: lang }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.token) return router.push(`/reservation/${d.token}`);
      setError(d.error === 'slot_unavailable' ? r.invalidTime : d.error === 'validation_failed' ? m.validation.required : res.status === 429 ? r.noAvailability : r.noAvailability);
    } catch {
      setError(m.common.connectionLost);
    }
    setBusy(false);
  };

  const input = 'h-11 w-full rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-base';
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="reserve-form">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{r.date}</span>
          <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={input} data-testid="reserve-date" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{r.partySize}</span>
          <select value={party} onChange={(e) => setParty(Number(e.target.value))} className={input} data-testid="reserve-party">
            {Array.from({ length: maxParty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs opacity-70">{fmt(r.maxPartySize, { n: maxParty })}</p>
      <fieldset aria-busy={loadingSlots} className={cn('transition-opacity', loadingSlots && 'pointer-events-none opacity-50')} data-testid="reserve-times" data-for={slotsFor}>
        <legend className="mb-2 text-sm font-medium">
          {r.time}
          {loadingSlots && <span className="ms-2 text-xs font-normal opacity-70" role="status">{m.common.loading}</span>}
        </legend>
        {slotsFailed ? (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
            {m.common.connectionLost}
            <button type="button" className="font-medium underline" onClick={() => setSlotsFor('')}>{m.common.retry}</button>
          </p>
        ) : reason === 'hours_not_configured' ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{r.hoursNotSet}</p>
        ) : reason === 'date_out_of_range' ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{r.dateTooFar}</p>
        ) : slots.filter((s) => s.available).length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="no-slots">{r.noAvailability}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {slots.map((s) => (
              <button
                key={s.time}
                type="button"
                disabled={!s.available || loadingSlots}
                onClick={() => setTime(s.time)}
                className={cn('h-10 rounded-xl text-sm tabular-nums ring-1', time === s.time ? 'bg-sf-primary text-sf-on-primary ring-sf-primary' : 'bg-sf-card/80 ring-sf-text/10', !s.available && 'line-through opacity-40')}
                data-testid="reserve-slot"
              >
                {s.time}
              </button>
            ))}
          </div>
        )}
      </fieldset>
      <input required placeholder={r.name} aria-label={r.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} maxLength={80} />
      <input required type="tel" placeholder={r.phone} aria-label={r.phone} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} maxLength={20} />
      <input type="email" placeholder={`${r.email} (${m.common.optional})`} aria-label={r.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
      <textarea placeholder={`${r.specialRequest} (${m.common.optional})`} aria-label={r.specialRequest} value={form.specialRequest} onChange={(e) => setForm({ ...form, specialRequest: e.target.value.slice(0, 500) })} className="min-h-[70px] w-full rounded-xl border border-sf-text/10 bg-sf-card/80 p-3 text-base" />
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <button type="submit" disabled={busy} className="h-12 w-full rounded-2xl bg-sf-primary font-medium text-sf-on-primary disabled:opacity-50" data-testid="reserve-submit">
        {busy ? sendingLabel : r.submit}
      </button>
      <p className="text-xs opacity-70">{r.keepPage}</p>
    </form>
  );
}
