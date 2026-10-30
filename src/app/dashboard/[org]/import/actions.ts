'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { UserFacingError } from '@/server/errors';
import { addImportSource, cancelImport, chooseCanonical, createImportJob, publishImport, setImportDecision } from '@/server/import/service';
import { MAX_IMPORT_BYTES } from '@/server/import/types';

const R = { revalidate: '/dashboard/[org]' };

export async function createImportJobAction(_p: ActionResult, form: FormData) {
  const res = await runTenantAction(form.get('org'), 'import.manage', (ctx) => createImportJob(ctx).then((j) => ({ id: j.id, slug: ctx.org.slug })));
  if (res.ok && res.data) redirect(`/dashboard/${res.data.slug}/import/${res.data.id}`);
  return res;
}

export async function addSourceAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    async (ctx) => {
      const file = form.get('file');
      let bytes: Uint8Array | undefined;
      let fileName: string | undefined;
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_IMPORT_BYTES) throw new UserFacingError('The file is larger than 5 MB.');
        bytes = new Uint8Array(await file.arrayBuffer());
        fileName = file.name.slice(0, 200);
      }
      const text = String(form.get('text') ?? '');
      const url = String(form.get('url') ?? '');
      if (!bytes && !text.trim() && !url.trim()) throw new UserFacingError('Choose a file, paste text or enter a link.');
      const r = await addImportSource(ctx, String(form.get('jobId')), { type: form.get('type'), text, url, fileName }, bytes);
      if (r.status !== 'PARSED') {
        revalidatePath(`/dashboard/${ctx.org.slug}/import/${String(form.get('jobId'))}`);
        throw new UserFacingError(r.error ?? 'Nothing could be extracted from this source.');
      }
      return r;
    },
    R,
  );
}

export async function setDecisionAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    (ctx) => setImportDecision(ctx, String(form.get('jobId')), { importedProductId: form.get('importedProductId'), decision: form.get('decision'), targetProductId: form.get('targetProductId') || undefined }),
    R,
  );
}

export async function chooseCanonicalAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'import.manage', (ctx) => chooseCanonical(ctx, String(form.get('jobId')), String(form.get('mappingId')), String(form.get('importedProductId'))), R);
}

export async function publishImportAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    (ctx) =>
      publishImport(ctx, String(form.get('jobId')), {
        confirm: form.get('confirm') === 'on' ? true : undefined,
        makeVisible: form.get('makeVisible') === 'on',
        imageRights: form.get('imageRights') === 'on',
        stations: Object.fromEntries([...form.entries()].filter(([k, v]) => k.startsWith('station:') && typeof v === 'string' && v).map(([k, v]) => [k.slice('station:'.length), String(v)])),
      }),
    R,
  );
}

export async function cancelImportAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'import.manage', (ctx) => cancelImport(ctx, String(form.get('jobId'))), R);
}
