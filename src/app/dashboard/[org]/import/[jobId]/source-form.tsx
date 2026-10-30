'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@/lib/upload-messages';
import { addSourceAction } from '../actions';

const TYPES = [
  { v: 'CSV', label: 'CSV file', file: '.csv,text/csv,text/plain', text: true },
  { v: 'XLSX', label: 'Excel (.xlsx)', file: '.xlsx', text: false },
  { v: 'PDF', label: 'PDF menu (digital, not scanned)', file: 'application/pdf,.pdf', text: false },
  { v: 'TEXT', label: 'Paste menu text', file: '', text: true },
  { v: 'GLOVO', label: 'Glovo — merchant export or pasted menu', file: '.csv,.xlsx', text: true, url: true },
  { v: 'UBER_EATS', label: 'Uber Eats — merchant export or pasted menu', file: '.csv,.xlsx', text: true, url: true },
  { v: 'IMAGE', label: 'Photo of a menu (needs OCR — not configured)', file: 'image/*', text: false },
] as const;

export function AddSourceForm({ org, jobId }: { org: string; jobId: string }) {
  const [type, setType] = useState<(typeof TYPES)[number]['v']>('CSV');
  const t = TYPES.find((x) => x.v === type)!;
  return (
    <ActionForm action={addSourceAction} submitLabel="Read this source" resetOnSuccess successText="Items extracted — review them below" testId="add-source-form">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="jobId" value={jobId} />
      <Field label="Source" htmlFor="type">
        <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          {TYPES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
        </Select>
      </Field>
      {t.file && (
        <Field label="File" htmlFor="file" hint="Up to 5 MB. Columns such as Category, Name, Description, Price, Size are recognised in PT, EN, FR, ES and AR.">
          <Input key={type} id="file" name="file" type="file" accept={t.file} data-max-bytes={DEFAULT_UPLOAD_MAX_BYTES} className="pt-2" />
        </Field>
      )}
      {t.text && (
        <Field label={type === 'TEXT' ? 'Menu text' : 'Or paste the content'} htmlFor="text" hint="One dish per line with the price at the end, e.g. “Tajine de frango 16,90 €”. Section titles on their own line.">
          <Textarea id="text" name="text" className="min-h-[140px] font-mono text-xs" />
        </Field>
      )}
      {'url' in t && t.url && (
        <Field label="Store link (for reference)" htmlFor="url" hint="MenuNiva does not copy menus from Glovo/Uber Eats pages without their authorisation. The link is kept for reference only.">
          <Input id="url" name="url" type="url" placeholder="https://" />
        </Field>
      )}
    </ActionForm>
  );
}
