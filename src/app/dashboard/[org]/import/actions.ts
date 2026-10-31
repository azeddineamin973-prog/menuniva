'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { UserFacingError } from '@/server/errors';
import {
  addImportSource,
  bulkUpdateImportedProducts,
  cancelImport,
  chooseCanonical,
  publishImport,
  setImportDecision,
  setImportedProductPhoto,
  startImport,
  updateImportedProduct,
} from '@/server/import/service';
import { MAX_IMPORT_BYTES } from '@/server/import/types';

const R = { revalidate: '/dashboard/[org]' };

async function readUpload(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { bytes: undefined, fileName: undefined };
  if (file.size > MAX_IMPORT_BYTES) throw new UserFacingError('The file is larger than 5 MB.');
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name.slice(0, 200) };
}

function sourceFields(form: FormData) {
  return { type: form.get('type') ?? 'GLOVO', text: String(form.get('text') ?? ''), url: String(form.get('url') ?? '').trim() };
}

/** "Paste the link → Import": reads the source and opens the review of what was found. */
export async function startImportAction(_p: ActionResult, form: FormData) {
  const res = await runTenantAction(
    form.get('org'),
    'import.manage',
    async (ctx) => {
      const { bytes, fileName } = await readUpload(form);
      const s = sourceFields(form);
      if (!bytes && !s.text.trim() && !s.url) throw new UserFacingError(s.type === 'GLOVO' ? 'Paste your Glovo store link first.' : 'Choose a file or paste your menu first.');
      const r = await startImport(ctx, { ...s, fileName }, bytes);
      return { slug: ctx.org.slug, jobId: r.jobId };
    },
    R,
  );
  if (res.ok && res.data) redirect(`/dashboard/${res.data.slug}/import/${res.data.jobId}`);
  return res;
}

/** Adds another source (e.g. a CSV with your own prices) to an import that is still open. */
export async function addSourceAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    async (ctx) => {
      const { bytes, fileName } = await readUpload(form);
      const s = sourceFields(form);
      if (!bytes && !s.text.trim() && !s.url) throw new UserFacingError('Choose a file, paste text or enter a link.');
      const r = await addImportSource(ctx, String(form.get('jobId')), { ...s, fileName }, bytes);
      if (r.status !== 'PARSED') {
        revalidatePath(`/dashboard/${ctx.org.slug}/import/${String(form.get('jobId'))}`);
        throw new UserFacingError(r.error ?? 'Nothing could be extracted from this source.');
      }
      return r;
    },
    R,
  );
}

/** Saves the edit dialog: the product's details, and its decision when the owner changed it. */
export async function saveImportItemAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    async (ctx) => {
      const jobId = String(form.get('jobId'));
      const importedProductId = form.get('importedProductId');
      await updateImportedProduct(ctx, jobId, {
        importedProductId,
        name: form.get('name'),
        description: form.get('description') || undefined,
        categoryName: form.get('categoryName') || undefined,
        price: form.get('price') || undefined,
      });
      const decision = form.get('decision');
      const target = String(form.get('targetProductId') ?? '');
      const changed = decision !== form.get('currentDecision') || (decision === 'MERGE_INTO_EXISTING' && target !== String(form.get('currentTargetProductId') ?? ''));
      if (decision && changed) await setImportDecision(ctx, jobId, { importedProductId, decision, targetProductId: target || undefined });
    },
    R,
  );
}

/** Changes, removes or restores the photo of one product under review. */
export async function setImportPhotoAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    (ctx) => {
      const jobId = String(form.get('jobId'));
      const id = String(form.get('importedProductId'));
      const action = form.get('photoAction');
      if (action === 'upload') return setImportedProductPhoto(ctx, jobId, id, { action, file: form.get('photo'), rightsConfirmed: form.get('rightsConfirmed') === 'on' });
      if (action === 'remove' || action === 'restore') return setImportedProductPhoto(ctx, jobId, id, { action });
      throw new UserFacingError('Unknown photo action.');
    },
    R,
  );
}

export async function bulkUpdateAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'import.manage',
    (ctx) =>
      bulkUpdateImportedProducts(ctx, String(form.get('jobId')), {
        action: form.get('action'),
        ids: String(form.get('ids') ?? '')
          .split(',')
          .filter(Boolean),
        categoryName: form.get('categoryName') || undefined,
      }),
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
