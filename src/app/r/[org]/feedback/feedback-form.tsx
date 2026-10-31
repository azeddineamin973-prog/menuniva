'use client';

import { useState } from 'react';
import type { LanguageCode } from '@/generated/prisma/enums';
import type { Messages } from '@/i18n';
import { cn } from '@/lib/cn';

const CATS = ['FOOD_QUALITY', 'SERVICE', 'WAITING_TIME', 'CLEANLINESS', 'VALUE', 'DELIVERY', 'OTHER'] as const;

/**
 * Private feedback form. The Google review link (if the restaurant configured one) is rendered
 * by the page OUTSIDE this component, identically for everyone — it never depends on the stars.
 */
export function FeedbackForm({ org, l, orderToken, lang, m }: { org: string; l?: string; orderToken?: string; lang: LanguageCode; m: Pick<Messages, 'feedback' | 'common' | 'validation'> }) {
  const f = m.feedback;
  const [rating, setRating] = useState(0);
  const [cats, setCats] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [follow, setFollow] = useState(false);
  const [contact, setContact] = useState({ name: '', info: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return setError(f.ratingLabel);
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/public/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: org, locationSlug: l, orderToken, rating, categories: cats, comment: comment || undefined, wantsFollowUp: follow, contactName: contact.name || undefined, contactInfo: contact.info || undefined, language: lang }),
      });
      if (res.ok) return setState('done');
      const d = await res.json().catch(() => ({}));
      setError(d.error === 'already_submitted' ? f.thanks : d.error === 'validation_failed' ? m.validation.required : m.common.retry);
    } catch {
      setError(m.common.connectionLost);
    }
    setState('idle');
  };

  if (state === 'done') return <p className="rounded-2xl bg-sf-card/80 p-5 text-center text-lg" role="status" data-testid="feedback-thanks">{f.thanks}</p>;

  const input = 'h-11 w-full rounded-xl border border-sf-text/10 bg-sf-card/80 px-3 text-base';
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="feedback-form">
      <fieldset>
        <legend className="mb-2 font-medium">{f.ratingLabel}</legend>
        <div className="flex justify-center gap-2" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n}/5`} aria-pressed={rating === n} onClick={() => setRating(n)} className={cn('h-12 w-12 rounded-full text-2xl ring-1 ring-sf-text/10', n <= rating ? 'bg-sf-accent text-white' : 'bg-sf-card/80')} data-testid={`star-${n}`}>
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{f.categoriesLabel} <span className="opacity-60">({m.common.optional})</span></legend>
        <div className="flex flex-wrap gap-2">
          {CATS.map((c) => (
            <button key={c} type="button" aria-pressed={cats.includes(c)} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])} className={cn('min-h-10 rounded-full px-3.5 py-2 text-sm ring-1', cats.includes(c) ? 'bg-sf-primary text-sf-on-primary ring-sf-primary' : 'bg-sf-card/80 ring-sf-text/10')}>
              {f.categories[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 2000))} placeholder={f.comment} aria-label={f.comment} className="min-h-[100px] w-full rounded-xl border border-sf-text/10 bg-sf-card/80 p-3 text-base" />
      <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-testid="follow-up" />
        {f.followUp}
      </label>
      {follow && (
        <div className="space-y-2">
          <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder={`${f.contactName} (${m.common.optional})`} aria-label={f.contactName} className={input} maxLength={80} />
          <input required value={contact.info} onChange={(e) => setContact({ ...contact, info: e.target.value })} placeholder={f.contact} aria-label={f.contact} className={input} maxLength={120} />
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <button type="submit" disabled={state === 'sending'} className="h-12 w-full rounded-2xl bg-sf-primary font-medium text-sf-on-primary disabled:opacity-50" data-testid="feedback-submit">{f.submit}</button>
    </form>
  );
}
