'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { ProductThumb } from '@/components/dashboard/product-thumb';
import { Button } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { DEFAULT_UPLOAD_MAX_BYTES, uploadMessage } from '@/lib/upload-messages';
import { setImportPhotoAction } from '../actions';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const OK_TYPES = ACCEPT.split(',');

/**
 * Photo controls for one product under review: change it for your own photo, remove it, or go
 * back to the photo the source provided. Changes are saved straight away (the edit form around
 * it cannot contain this upload, because forms cannot be nested).
 */
export function PhotoPanel({
  org,
  jobId,
  itemId,
  imageUrl,
  sourceImageUrl,
  sourceLabel,
  onChanged,
}: {
  org: string;
  jobId: string;
  itemId: string;
  imageUrl: string | null;
  /** The photo the import source provided, when it differs from the current one. */
  sourceImageUrl: string | null;
  sourceLabel: string;
  onChanged: (imageUrl: string | null) => void;
}) {
  const [state, act, pending] = useActionState(setImportPhotoAction, initialActionState);
  const [rights, setRights] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rightsRef = useRef<HTMLInputElement>(null);
  const isOwn = !!imageUrl?.startsWith('/media/');
  const canRestore = !!sourceImageUrl && sourceImageUrl !== imageUrl;

  useEffect(() => {
    if (!state.ok) return;
    const data = state.data as { imageUrl?: string | null } | undefined;
    if (data && 'imageUrl' in data) onChanged(data.imageUrl ?? null);
    if (fileRef.current) fileRef.current.value = '';
  }, [state, onChanged]);

  const send = (fields: Record<string, string | File>) => {
    const fd = new FormData();
    fd.set('org', org);
    fd.set('jobId', jobId);
    fd.set('importedProductId', itemId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    // Dispatched outside a <form action>, so it must run in a transition for `pending` to update.
    startTransition(() => act(fd));
  };

  const pick = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!rights) {
      setLocalError('Tick the box below to confirm you may use this photo.');
      rightsRef.current?.focus();
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (!OK_TYPES.includes(file.type)) {
      setLocalError(uploadMessage('unsupported_type', document.documentElement.lang));
      return;
    }
    if (file.size > DEFAULT_UPLOAD_MAX_BYTES) {
      setLocalError(uploadMessage('image_too_large', document.documentElement.lang));
      return;
    }
    send({ photoAction: 'upload', photo: file, rightsConfirmed: 'on' });
  };

  const error = localError ?? (!state.ok && state.error ? friendlyError(state.error) : null);

  return (
    <div className="flex gap-4" data-testid="photo-panel">
      <div className="relative">
        <ProductThumb key={imageUrl ?? 'none'} src={imageUrl} size="lg" className="size-24" />
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface/70 text-xs font-medium" role="status">
            Saving…
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-muted" data-testid="photo-origin">
          {imageUrl ? (isOwn ? 'Your photo' : `Photo from ${sourceLabel}`) : 'No photo — the product is saved without one.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            id={`photo-${itemId}`}
            onChange={(e) => pick(e.target.files?.[0])}
            disabled={pending}
            data-testid="photo-file"
          />
          <label htmlFor={`photo-${itemId}`} className={`inline-flex h-8 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2 ${pending ? 'pointer-events-none opacity-50' : ''}`} data-testid="change-photo">
            {imageUrl ? 'Change photo' : 'Add photo'}
          </label>
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => send({ photoAction: 'remove' })} data-testid="remove-photo">
              Remove
            </Button>
          )}
          {canRestore && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => send({ photoAction: 'restore' })} data-testid="restore-photo">
              Use {sourceLabel} photo
            </Button>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
          <input ref={rightsRef} type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-3.5 accent-[#7ac70c]" data-testid="photo-rights" />
          <span>I own this photo or have permission to use it. PNG, JPEG or WebP, up to 5 MB.</span>
        </label>
        {error && (
          <p role="alert" className="text-xs font-medium text-danger" data-testid="photo-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
