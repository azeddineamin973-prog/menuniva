'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Messages } from '@/i18n';
import { fmt } from '@/i18n/config';

export type LoyaltyView = {
  type: 'STAMPS' | 'POINTS';
  target: number;
  reward: string | null;
  expiryDays: number | null;
  joined: boolean;
  balance: number;
  earnedForThisOrder: boolean;
  pendingEarn: number;
};

/**
 * Voluntary loyalty enrolment on the guest's own order page. Consent is an explicit, unticked
 * checkbox; marketing and birthday are separate optional choices. Unrelated to feedback.
 */
export function LoyaltyCard({ token, restaurant, view, m }: { token: string; restaurant: string; view: LoyaltyView; m: Pick<Messages, 'loyalty' | 'common'> }) {
  const l = m.loyalty;
  const router = useRouter();
  const unit = view.type === 'STAMPS' ? l.stamps : l.points;
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [bdConsent, setBdConsent] = useState(false);
  const [bd, setBd] = useState({ day: '', month: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) return setError(l.consentRequired);
    setSending(true);
    setError(null);
    try {
      const birthday = bdConsent && bd.day && bd.month ? `${bd.month}-${bd.day}` : undefined;
      const res = await fetch('/api/public/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderToken: token, phone, name: name || undefined, consent: true, marketingOptIn: marketing, birthday, birthdayConsent: !!birthday }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => ({}));
      setError(d.error === 'invalid_phone' ? l.invalidPhone : d.error === 'already_joined' ? l.joined : m.common.retry);
    } catch {
      setError(m.common.connectionLost);
    }
    setSending(false);
  };

  const header = (
    <>
      <h2 className="font-serif text-xl">{l.title}</h2>
      <p className="mt-1 text-sm opacity-80">{fmt(l.intro, { unit })}</p>
      {view.reward && <p className="mt-1 text-sm font-medium">{fmt(l.reward, { reward: view.reward })}</p>}
    </>
  );

  if (view.joined) {
    const pct = Math.min(100, Math.round((Math.max(0, view.balance) / view.target) * 100));
    return (
      <section className="rounded-3xl bg-sf-card/85 p-5 ring-1 ring-sf-text/5" data-testid="loyalty-card" data-joined="true">
        {header}
        <p className="mt-3 text-sm font-medium" role="status">{l.joined}</p>
        <div className="mt-2 h-2 rounded-full bg-sf-text/10" aria-hidden><div className="h-2 rounded-full bg-sf-primary" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-sm tabular-nums" data-testid="loyalty-progress">{fmt(l.progress, { balance: view.balance, target: view.target, unit })}</p>
        {view.balance >= view.target && <p className="mt-2 text-sm font-semibold">{l.rewardReady}</p>}
        <p className="mt-2 text-xs opacity-70">{view.earnedForThisOrder ? fmt(l.earned, { n: view.pendingEarn, unit }) : fmt(l.pending, { n: view.pendingEarn, unit })}</p>
        {view.expiryDays && <p className="mt-1 text-xs opacity-60">{fmt(l.expiry, { unit, days: view.expiryDays })}</p>}
      </section>
    );
  }

  const input = 'h-11 w-full rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-base';
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  return (
    <section className="rounded-3xl bg-sf-card/85 p-5 ring-1 ring-sf-text/5" data-testid="loyalty-card" data-joined="false">
      {header}
      <form onSubmit={join} className="mt-4 space-y-3">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder={l.phone} aria-label={l.phone} className={input} maxLength={30} data-testid="loyalty-phone" />
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder={`${l.name} (${m.common.optional})`} aria-label={l.name} className={input} maxLength={80} />
        <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-testid="loyalty-consent" />
          <span>{fmt(l.consent, { restaurant })}</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-testid="loyalty-marketing" />
          <span>{fmt(l.marketing, { restaurant })}</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
          <input type="checkbox" checked={bdConsent} onChange={(e) => setBdConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{l.birthdayConsent}</span>
        </label>
        {bdConsent && (
          <fieldset className="flex items-center gap-2">
            <legend className="mb-1 text-sm">{l.birthday}</legend>
            <select value={bd.day} onChange={(e) => setBd({ ...bd, day: e.target.value })} aria-label={l.day} className={input}>
              <option value="">{l.day}</option>
              {days.map((d) => <option key={d} value={d}>{Number(d)}</option>)}
            </select>
            <select value={bd.month} onChange={(e) => setBd({ ...bd, month: e.target.value })} aria-label={l.month} className={input}>
              <option value="">{l.month}</option>
              {months.map((x) => <option key={x} value={x}>{Number(x)}</option>)}
            </select>
          </fieldset>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        <button type="submit" disabled={sending} className="h-11 w-full rounded-2xl bg-sf-primary font-medium text-sf-on-primary disabled:opacity-50" data-testid="loyalty-join">{l.join}</button>
        {view.expiryDays && <p className="text-xs opacity-60">{fmt(l.expiry, { unit, days: view.expiryDays })}</p>}
      </form>
    </section>
  );
}
