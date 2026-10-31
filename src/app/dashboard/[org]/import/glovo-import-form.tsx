'use client';

import { useActionState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { Alert, Button, Input } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { startImportAction } from './actions';

const FOUND = ['Categories', 'Products & descriptions', 'Photos', 'Prices', 'Sizes & extras'];

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Paste a Glovo store link, press Import Menu, land on the review of what was found. */
export function GlovoImportForm({ org, defaultUrl }: { org: string; defaultUrl?: string | null }) {
  const [state, formAction, pending] = useActionState(startImportAction, initialActionState);
  const error = !state.ok && state.error ? (state.error === 'validation' ? 'Check the link and try again.' : friendlyError(state.error)) : null;

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]" aria-labelledby="glovo-import-title">
      <div className="p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#ffc244] text-lg font-black text-[#1d1d1b]" aria-hidden>
            G
          </span>
          <div className="min-w-0">
            <h2 id="glovo-import-title" className="text-lg font-semibold tracking-tight text-ink">
              Import from Glovo
            </h2>
            <p className="mt-0.5 text-sm text-muted">Paste your Glovo store link. Your menu appears here for review in a few seconds.</p>
          </div>
        </div>

        <form onSubmit={keepValuesOnSubmit(formAction)} className="mt-6 flex flex-col gap-3 sm:flex-row" data-testid="glovo-import-form">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="type" value="GLOVO" />
          <label htmlFor="glovo-url" className="sr-only">
            Glovo store link
          </label>
          <Input
            id="glovo-url"
            name="url"
            type="url"
            inputMode="url"
            required
            autoComplete="off"
            spellCheck={false}
            defaultValue={defaultUrl ?? ''}
            placeholder="https://glovoapp.com/pt/pt/braga/stores/your-restaurant-brg"
            aria-describedby="glovo-url-help"
            aria-invalid={!!error || undefined}
            // flex-1 only in the row layout: in a column it would override the field's height.
            className="h-12 min-w-0 text-base sm:flex-1 sm:text-sm"
            data-testid="glovo-url-input"
          />
          <Button type="submit" size="lg" disabled={pending} className="h-12 sm:min-w-44" data-testid="import-menu-button">
            {pending ? (
              <>
                <Spinner /> Importing…
              </>
            ) : (
              'Import Menu'
            )}
          </Button>
        </form>
        <p id="glovo-url-help" className="mt-2 text-xs text-muted">
          Open your restaurant on glovoapp.com and copy the address from your browser’s address bar.
        </p>

        {pending && (
          <p role="status" className="mt-4 text-sm text-muted">
            Reading your Glovo menu…
          </p>
        )}
        {error && !pending && (
          <div className="mt-4" data-testid="glovo-import-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line bg-surface-2/60 px-5 py-3 text-xs text-muted sm:px-8">
        {FOUND.map((f) => (
          <span key={f} className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="size-3.5 text-success" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {f}
          </span>
        ))}
        <span className="sm:ms-auto">Saved as drafts · Glovo prices kept separate</span>
      </div>
    </section>
  );
}
