'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Badge, Button, Field, Icon, Input, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { GLOVO_CAPTURE_SNIPPET, GLOVO_CAPTURE_STEPS } from '@/lib/glovo-capture';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@/lib/upload-messages';
import { addSourceAction, startImportAction } from './actions';

type Status = 'CONNECTED' | 'LIMITED' | 'NOT_CONFIGURED' | 'ERROR';
export type AdapterStatus = { type: string; status: Status; note: string };

const OPTIONS = [
  { v: 'CSV', label: 'CSV file', hint: 'Spreadsheet export', accept: '.csv,text/csv,text/plain', file: true, text: true },
  { v: 'XLSX', label: 'Excel', hint: '.xlsx workbook', accept: '.xlsx', file: true, text: false },
  { v: 'PDF', label: 'PDF menu', hint: 'Digital PDF, not scanned', accept: 'application/pdf,.pdf', file: true, text: false },
  { v: 'TEXT', label: 'Paste text', hint: 'One dish per line', accept: '', file: false, text: true },
  { v: 'GLOVO', label: 'Glovo export', hint: 'Partner file or browser capture', accept: '.csv,.xlsx', file: true, text: true },
  { v: 'UBER_EATS', label: 'Uber Eats export', hint: 'Merchant export file', accept: '.csv,.xlsx', file: true, text: true },
] as const;
type OptionType = (typeof OPTIONS)[number]['v'];

const BADGE: Record<Status, { tone: 'success' | 'warning' | 'neutral' | 'danger'; label: string } | null> = {
  CONNECTED: null,
  LIMITED: { tone: 'warning', label: 'Limited' },
  NOT_CONFIGURED: { tone: 'neutral', label: 'Not connected' },
  ERROR: { tone: 'danger', label: 'Error' },
};

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Instructions for capturing the menu in the owner's own browser, for when the link cannot be read. */
function CaptureHelp() {
  const [copied, setCopied] = useState(false);
  return (
    <details className="rounded-xl border border-line bg-surface-2/60 p-3 text-xs" data-testid="glovo-capture-help">
      <summary className="cursor-pointer font-medium text-ink">Link did not work? Capture the menu in your browser</summary>
      <ol className="mt-3 space-y-1.5 text-muted">
        {GLOVO_CAPTURE_STEPS.map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="font-semibold text-ink tabular-nums">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="copy-glovo-snippet"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(GLOVO_CAPTURE_SNIPPET);
              setCopied(true);
              setTimeout(() => setCopied(false), 4000);
            } catch {
              setCopied(false);
            }
          }}
        >
          Copy the capture snippet
        </Button>
        {copied && (
          <span role="status" className="font-medium text-success">
            ✓ Copied
          </span>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted">Show the snippet</summary>
        <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{GLOVO_CAPTURE_SNIPPET}</pre>
      </details>
    </details>
  );
}

/**
 * Every other way to bring a menu in, kept out of the way of the main Glovo link. On the review
 * page (with `jobId`) it adds a source to the open import instead of starting a new one.
 */
export function AdvancedImport({
  org,
  adapters,
  jobId,
  menuHref,
  title = 'Advanced import options',
  defaultOpen = false,
}: {
  org: string;
  adapters: AdapterStatus[];
  jobId?: string;
  menuHref?: string;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [type, setType] = useState<OptionType>('CSV');
  const opt = OPTIONS.find((o) => o.v === type)!;
  const status = new Map(adapters.map((a) => [a.type, a]));
  const photo = status.get('IMAGE');

  return (
    <details className="group rounded-[var(--radius-card)] border border-line bg-surface shadow-xs" open={defaultOpen} data-testid="advanced-import">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[var(--radius-card)] px-4 py-3.5 hover:bg-surface-2/40 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2" aria-hidden>
            <Icon name="import" />
          </span>
          <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="block text-xs text-muted">CSV, Excel, PDF, pasted text, Uber Eats or Glovo export files</span>
          </span>
        </span>
        <Chevron />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">
        <ActionForm
          action={jobId ? addSourceAction : startImportAction}
          submitLabel={jobId ? 'Add source' : 'Import'}
          resetOnSuccess
          successText="Products added — review them below"
          testId="add-source-form"
        >
          <input type="hidden" name="org" value={org} />
          {jobId && <input type="hidden" name="jobId" value={jobId} />}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Source</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {OPTIONS.map((o) => {
                const a = status.get(o.v);
                const badge = a ? BADGE[a.status] : null;
                return (
                  <label
                    key={o.v}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                      type === o.v ? 'border-graphite bg-surface-2 ring-1 ring-graphite dark:border-lime dark:ring-lime' : 'border-line hover:bg-surface-2',
                    )}
                    title={a?.note}
                    data-testid={`adapter-${o.v}`}
                  >
                    <input type="radio" name="type" value={o.v} checked={type === o.v} onChange={() => setType(o.v)} className="mt-1 accent-[#6cb30a]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{o.label}</span>
                        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                      </span>
                      <span className="block text-xs text-muted">{o.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {photo && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="adapter-IMAGE">
                <Badge tone={BADGE[photo.status]?.tone ?? 'neutral'}>{BADGE[photo.status]?.label ?? 'Available'}</Badge>
                Photos of a paper menu need an OCR service, which is not connected.
              </p>
            )}
          </fieldset>

          {opt.file && (
            <Field label={type === 'GLOVO' ? 'Glovo menu export (CSV or Excel)' : 'File'} htmlFor="file" hint="Up to 5 MB. Columns such as Category, Name, Description, Price and Size are recognised.">
              <Input key={type} id="file" name="file" type="file" accept={opt.accept} data-max-bytes={DEFAULT_UPLOAD_MAX_BYTES} className="pt-2" />
            </Field>
          )}
          {opt.text && (
            <Field
              label={type === 'TEXT' ? 'Menu text' : type === 'GLOVO' ? 'Or paste a browser capture' : 'Or paste the content'}
              htmlFor="text"
              hint={type === 'GLOVO' ? 'Paste what the capture snippet copied.' : 'One dish per line with the price at the end, e.g. “Tajine de frango 16,90 €”.'}
            >
              <Textarea key={type} id="text" name="text" className="min-h-[120px] font-mono text-xs" data-testid="source-text" />
            </Field>
          )}
          {type === 'GLOVO' && <CaptureHelp />}
        </ActionForm>
        {menuHref && (
          <p className="mt-4 border-t border-line pt-4 text-xs text-muted">
            Prefer typing?{' '}
            <Link href={menuHref} className="font-medium text-ink underline-offset-2 hover:underline">
              Add dishes one by one
            </Link>{' '}
            in the menu editor.
          </p>
        )}
      </div>
    </details>
  );
}
